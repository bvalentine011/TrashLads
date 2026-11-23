import { createHash } from "node:crypto";
import { CAPACITY, PAYMENTS, TERMS } from "../config";
import { serviceDateProblem, type ServiceDateProblem } from "../dates";
import { AppError } from "../domain/errors";
import type { Booking, Property } from "../domain/types";
import { priceFor, type PriceBreakdown } from "../pricing";
import type { Caller, Ctx } from "./context";
import { ensureStripeCustomer } from "./customers";
import { requireCurrentRegistrationTerms } from "./terms";

export interface CreateBookingPaymentRequest {
  /** A random id the client creates once per checkout, so retries never double-book. */
  clientRequestId: string;
  propertyId: string;
  buildingLabel?: string;
  unitLabel: string;
  serviceDate: string;
  bagCount: number;
  instructions?: string;
  contact: { name: string; phone: string; email?: string };
  /** Version of the service terms the resident ticked at checkout. */
  acceptedServiceTermsVersion: string;
  acceptedPlacementPolicy: boolean;
  /** Present only when the resident ticked "Save this card". */
  saveCardConsentVersion?: string;
}

export interface CreateBookingPaymentResult {
  bookingId: string;
  clientSecret: string;
  price: PriceBreakdown;
  holdExpiresAt: string;
}

const DATE_MESSAGES: Record<ServiceDateProblem, string> = {
  invalid: "Choose a pickup date.",
  past: "That date has passed. Choose another night.",
  weekend: "Trash Lad picks up Monday to Friday only.",
  closed: "There's no service that night. Choose another night.",
  "too-far": "You can book up to 3 weeks ahead.",
  "same-day-closed": "Same-day booking closes at 8 PM. Choose a later night.",
};

const UNIT_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{0,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length <= max ? t : null;
}

function digits(v: string): string {
  return v.replace(/\D/g, "");
}

/** Everything the client sent is re-checked here; nothing it computed is trusted. */
export function validateRequest(req: unknown, now: Date): CreateBookingPaymentRequest {
  if (!req || typeof req !== "object") throw new AppError("invalid-argument", "Missing booking details.");
  const r = req as Record<string, unknown>;
  const bad = (msg: string, reason?: string) => new AppError("invalid-argument", msg, reason);

  const clientRequestId = str(r.clientRequestId, 64);
  if (!clientRequestId || !/^[A-Za-z0-9_-]{8,64}$/.test(clientRequestId)) throw bad("Missing request id.");
  const propertyId = str(r.propertyId, 64);
  if (!propertyId) throw bad("Choose your apartment community.");
  const buildingLabel = str(r.buildingLabel ?? "", 40);
  if (buildingLabel === null) throw bad("Keep the building under 40 characters.");
  const unitLabel = str(r.unitLabel, 16);
  if (!unitLabel || !UNIT_RE.test(unitLabel)) throw bad("Use letters, numbers or a dash for your unit (e.g. 204 or 12-B).");
  const problem = serviceDateProblem(r.serviceDate, now);
  if (problem) throw bad(DATE_MESSAGES[problem], `date-${problem}`);
  priceFor(r.bagCount as number); // throws on anything but 1, 2 or 3
  const instructions = str(r.instructions ?? "", 280);
  if (instructions === null) throw bad("Keep pickup instructions under 280 characters.");

  const c = (r.contact ?? {}) as Record<string, unknown>;
  const name = str(c.name, 80);
  if (!name || name.length < 2) throw bad("Enter your name.");
  const phoneRaw = str(c.phone, 32);
  const phone = phoneRaw ? digits(phoneRaw).replace(/^1(?=\d{10}$)/, "") : "";
  if (phone.length !== 10) throw bad("Enter a 10-digit US phone number.");
  const email = str(c.email ?? "", 254);
  if (email === null || (email && !EMAIL_RE.test(email))) throw bad("Enter a valid email or leave it blank.");

  if (r.acceptedServiceTermsVersion !== TERMS.serviceTermsVersion) {
    throw new AppError("failed-precondition", "Accept the pickup service terms to continue.", "service-terms-required");
  }
  if (r.acceptedPlacementPolicy !== true) {
    throw new AppError("failed-precondition", "Agree to the trash placement rules to continue.", "placement-policy-required");
  }
  if (r.saveCardConsentVersion !== undefined && r.saveCardConsentVersion !== TERMS.savedCardConsentVersion) {
    throw new AppError("failed-precondition", "The save-card wording changed. Review it and try again.", "save-card-consent-outdated");
  }

  return {
    clientRequestId,
    propertyId,
    buildingLabel: buildingLabel || undefined,
    unitLabel: unitLabel.toUpperCase(),
    serviceDate: r.serviceDate as string,
    bagCount: r.bagCount as number,
    instructions: instructions || undefined,
    contact: { name, phone, email: email || undefined },
    acceptedServiceTermsVersion: r.acceptedServiceTermsVersion as string,
    acceptedPlacementPolicy: true,
    saveCardConsentVersion: r.saveCardConsentVersion as string | undefined,
  };
}

export function assertPropertyServed(p: Property | null): asserts p is Property {
  if (!p || !p.approved || !p.enabled) {
    throw new AppError("failed-precondition", "Trash Lad doesn't serve this community yet.", "property-not-served");
  }
}

function isKnownLocation(p: Property, building: string | undefined, unit: string): boolean {
  if (!p.buildings?.length) return false;
  const b = p.buildings.find((x) => x.label.toLowerCase() === (building ?? "").toLowerCase());
  if (!b) return false;
  return !b.units || b.units.map((u) => u.toUpperCase()).includes(unit);
}

/** Deterministic id: the same caller retrying the same checkout gets the same booking. */
export function bookingIdFor(uid: string, clientRequestId: string): string {
  return "bk_" + createHash("sha256").update(`${uid}:${clientRequestId}`).digest("hex").slice(0, 24);
}

/**
 * Step 1 of checkout. Verifies the resident, terms, property, date, capacity and
 * price on the server, holds capacity, and creates a PaymentIntent for the
 * server-computed amount. The booking stays "pending_payment" until the
 * payment_intent.succeeded webhook is verified.
 */
export async function createBookingPayment(ctx: Ctx, caller: Caller, raw: unknown): Promise<CreateBookingPaymentResult> {
  const now = ctx.now();
  await requireCurrentRegistrationTerms(ctx, caller.uid);
  const req = validateRequest(raw, now);
  const property = await ctx.store.getProperty(req.propertyId);
  assertPropertyServed(property);
  const price = priceFor(req.bagCount);
  const customerId = await ensureStripeCustomer(ctx, caller);
  const bookingId = bookingIdFor(caller.uid, req.clientRequestId);

  const existing = await ctx.store.getBooking(bookingId);
  if (existing) return resumeExisting(ctx, caller, existing);

  const nowIso = now.toISOString();
  const holdExpiresAt = new Date(now.getTime() + PAYMENTS.holdMinutes * 60_000).toISOString();
  const booking: Booking = {
    id: bookingId,
    uid: caller.uid,
    propertyId: property.id,
    buildingLabel: req.buildingLabel ?? "",
    unitLabel: req.unitLabel,
    locationUnverified: !isKnownLocation(property, req.buildingLabel, req.unitLabel),
    serviceDate: req.serviceDate,
    bagCount: req.bagCount,
    instructions: req.instructions,
    contact: req.contact,
    price,
    status: "pending_payment",
    serviceTerms: { version: req.acceptedServiceTermsVersion, acceptedAt: nowIso },
    placementPolicyAcceptedAt: nowIso,
    saveCardConsent: req.saveCardConsentVersion ? { version: req.saveCardConsentVersion, acceptedAt: nowIso } : undefined,
    stripeCustomerId: customerId,
    holdExpiresAt,
    amountRefundedCents: 0,
    refundState: "none",
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await ctx.store.reserveBooking(booking, { maxStops: CAPACITY.maxStopsPerNight, maxBags: CAPACITY.maxBagsPerNight });

  let intent;
  try {
    intent = await ctx.gateway.createPaymentIntent(
      {
        amountCents: price.totalCents,
        currency: price.currency,
        customerId,
        saveForFutureOnSession: !!booking.saveCardConsent,
        description: `Trash Lad pickup ${req.serviceDate}, ${req.bagCount} bag${req.bagCount > 1 ? "s" : ""}`,
        metadata: { bookingId, uid: caller.uid, serviceDate: req.serviceDate, bagCount: String(req.bagCount) },
      },
      `pi-${bookingId}`,
    );
  } catch (err) {
    // Give the night's capacity back if Stripe couldn't create the payment.
    await ctx.store.transitionBooking(bookingId, ["pending_payment"], { status: "expired", updatedAt: ctx.now().toISOString() });
    throw err;
  }

  await ctx.store.transitionBooking(bookingId, ["pending_payment"], { paymentIntentId: intent.id, updatedAt: nowIso });
  await ctx.store.audit({
    at: nowIso,
    actor: caller.uid,
    action: "booking-payment-created",
    bookingId,
    detail: { amount: price.totalCents, paymentIntentId: intent.id, saveCard: !!booking.saveCardConsent },
  });
  if (!intent.clientSecret) throw new AppError("internal", "Payment couldn't be started. Try again.");
  return { bookingId, clientSecret: intent.clientSecret, price, holdExpiresAt };
}

async function resumeExisting(ctx: Ctx, caller: Caller, b: Booking): Promise<CreateBookingPaymentResult> {
  if (b.uid !== caller.uid) throw new AppError("permission-denied", "This booking belongs to another account.");
  if (b.status !== "pending_payment" || !b.paymentIntentId) {
    throw new AppError("failed-precondition", "This checkout has already finished. Start a new booking.", `booking-${b.status}`);
  }
  const intent = await ctx.gateway.retrievePaymentIntent(b.paymentIntentId);
  if (!intent.clientSecret) throw new AppError("internal", "Payment couldn't be resumed. Start a new booking.");
  return { bookingId: b.id, clientSecret: intent.clientSecret, price: b.price, holdExpiresAt: b.holdExpiresAt };
}

/** Releases holds whose payment never arrived. Run on a schedule. */
export async function expireHolds(ctx: Ctx, limit = 100): Promise<{ expired: number; skipped: number }> {
  const nowIso = ctx.now().toISOString();
  const due = await ctx.store.findExpiredHolds(nowIso, limit);
  let expired = 0;
  let skipped = 0;
  for (const b of due) {
    if (b.paymentIntentId) {
      const pi = await ctx.gateway.retrievePaymentIntent(b.paymentIntentId);
      // Money is moving or has moved: let the webhook confirm it instead.
      if (pi.status === "succeeded" || pi.status === "processing") {
        skipped++;
        continue;
      }
      if (pi.status !== "canceled") {
        try {
          await ctx.gateway.cancelPaymentIntent(b.paymentIntentId);
        } catch {
          // The intent changed state while we looked at it; the next run will retry.
          skipped++;
          continue;
        }
      }
    }
    const done = await ctx.store.transitionBooking(b.id, ["pending_payment"], { status: "expired", updatedAt: nowIso });
    if (done) {
      expired++;
      await ctx.store.audit({ at: nowIso, actor: "system", action: "hold-expired", bookingId: b.id });
    }
  }
  return { expired, skipped };
}
