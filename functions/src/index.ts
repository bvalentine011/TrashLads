import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import Stripe from "stripe";
import { FirestoreStore } from "./adapters/firestoreStore";
import { assertKeyAllowed } from "./adapters/liveModeGuard";
import { StripeGateway } from "./adapters/stripeGateway";
import { ROLES } from "./config";
import { AppError } from "./domain/errors";
import { createBookingPayment, expireHolds } from "./services/booking";
import type { Caller, Ctx } from "./services/context";
import { cancelBooking, ownerRefund, requestRefundException, reviewRefundRequest } from "./services/refunds";
import { createSaveCardSetup, listSavedCards, preparePaymentElement, removeSavedCard } from "./services/savedMethods";
import { acceptRegistrationTerms } from "./services/terms";
import { handleWebhookEvent } from "./services/webhook";
import { ownerSetBookingStatus, ownerStartRoute } from "./services/ownerRoute";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const secrets = [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET];
const region = "us-east1";
/**
 * App Check blocks calls that don't come from your real website. It's on unless
 * ENFORCE_APP_CHECK=false is set in functions/.env, which is only allowed in test mode:
 * the live-mode guard refuses a live Stripe key while it's off.
 */
const enforceAppCheck = process.env.ENFORCE_APP_CHECK !== "false";

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

let cached: { ctx: Ctx; stripe: Stripe } | null = null;
/** Built on first use, so deploys don't need the secret and a live key is checked before any call. */
function context(): { ctx: Ctx; stripe: Stripe } {
  if (cached) return cached;
  const key = STRIPE_SECRET_KEY.value();
  const livemode = assertKeyAllowed(key, process.env);
  const stripe = new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "Trash Lad" } });
  cached = { stripe, ctx: { store: new FirestoreStore(db), gateway: new StripeGateway(stripe, livemode), now: () => new Date() } };
  return cached;
}

function callerOf(req: CallableRequest): Caller {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const t = req.auth.token;
  return { uid: req.auth.uid, email: t.email, name: t.name as string | undefined, isOwner: t[ROLES.ownerClaim] === true };
}

/** Wraps a service so AppErrors reach the client as typed HttpsErrors and nothing else leaks. */
function callable<T>(fn: (ctx: Ctx, caller: Caller, data: any) => Promise<T>) {
  return onCall({ region, secrets, enforceAppCheck }, async (req) => {
    const caller = callerOf(req);
    try {
      return await fn(context().ctx, caller, req.data ?? {});
    } catch (err) {
      if (err instanceof AppError) throw new HttpsError(err.code, err.message, { reason: err.reason });
      if (err instanceof HttpsError) throw err;
      logger.error("callable failed", { uid: caller.uid, error: (err as Error).message });
      throw new HttpsError("internal", "Something went wrong. Try again.");
    }
  });
}

export const acceptTerms = callable((ctx, caller, data) => acceptRegistrationTerms(ctx, caller, data.version));
export const getCheckoutSetup = callable((ctx, caller) => preparePaymentElement(ctx, caller));
export const startBookingPayment = callable((ctx, caller, data) => createBookingPayment(ctx, caller, data));
export const cancelMyBooking = callable((ctx, caller, data) => cancelBooking(ctx, caller, data.bookingId));
export const requestRefund = callable((ctx, caller, data) => requestRefundException(ctx, caller, data));
export const ownerReviewRefund = callable((ctx, caller, data) => reviewRefundRequest(ctx, caller, data));
export const ownerIssueRefund = callable((ctx, caller, data) => ownerRefund(ctx, caller, data));
export const startSaveCard = callable((ctx, caller, data) => createSaveCardSetup(ctx, caller, data));
export const listMyCards = callable((ctx, caller) => listSavedCards(ctx, caller));
export const ownerSetStatus = callable((ctx, caller, data) => ownerSetBookingStatus(ctx, caller, data));
export const ownerStartNight = callable((ctx, caller, data) => ownerStartRoute(ctx, caller, data));
export const removeMyCard = callable((ctx, caller, data) => removeSavedCard(ctx, caller, data));

/** Stripe webhook. Point the Stripe endpoint at this function's URL. */
export const stripeWebhook = onRequest({ region, secrets, invoker: "public" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  const { ctx, stripe } = context();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.get("stripe-signature") ?? "", STRIPE_WEBHOOK_SECRET.value());
  } catch {
    res.status(400).send("Invalid signature");
    return;
  }
  try {
    const outcome = await handleWebhookEvent(ctx, {
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      object: event.data.object as unknown as Record<string, any>,
    });
    res.status(200).json({ received: true, outcome });
  } catch (err) {
    logger.error("webhook failed", { eventId: event.id, type: event.type, error: (err as Error).message });
    // A non-2xx makes Stripe retry with backoff.
    res.status(500).send("Retry");
  }
});

/** Releases capacity held by checkouts that were never paid. */
export const releaseUnpaidHolds = onSchedule({ region, secrets, schedule: "every 5 minutes", timeZone: "America/New_York" }, async () => {
  const result = await expireHolds(context().ctx);
  if (result.expired || result.skipped) logger.info("holds released", result);
});
