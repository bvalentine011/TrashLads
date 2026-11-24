import { AppError } from "../domain/errors";
import type { Booking } from "../domain/types";
import type { Ctx } from "./context";
import { refundLatePayment } from "./refunds";

/** The parts of a verified Stripe event the handlers use. */
export interface WebhookEvent {
  id: string;
  type: string;
  livemode: boolean;
  object: Record<string, any>;
}

export type WebhookOutcome = "processed" | "duplicate" | "in-progress" | "ignored";

/**
 * Processes each Stripe event exactly once. The event id is claimed atomically
 * before any work; a failure releases the claim so Stripe's retry runs it again.
 * Every handler is also safe to run twice, because each change is conditional
 * on the booking's current status.
 */
export async function handleWebhookEvent(ctx: Ctx, event: WebhookEvent): Promise<WebhookOutcome> {
  const nowIso = ctx.now().toISOString();
  if (event.livemode !== ctx.gateway.livemode) {
    // A live event reaching a test deployment (or the reverse) is never acted on.
    await ctx.store.audit({ at: nowIso, actor: "stripe", action: "webhook-mode-mismatch", detail: { eventId: event.id, type: event.type } });
    return "ignored";
  }
  const claim = await ctx.store.claimEvent(event.id, event.type, nowIso);
  if (claim === "done") return "duplicate";
  if (claim === "in-progress") {
    // Tell Stripe to retry later rather than drop it.
    throw new AppError("failed-precondition", "Event is already being processed.");
  }
  try {
    const handled = await dispatch(ctx, event);
    await ctx.store.completeEvent(event.id, ctx.now().toISOString());
    return handled ? "processed" : "ignored";
  } catch (err) {
    await ctx.store.releaseEvent(event.id);
    throw err;
  }
}

async function dispatch(ctx: Ctx, event: WebhookEvent): Promise<boolean> {
  switch (event.type) {
    case "payment_intent.succeeded":
      await onPaymentSucceeded(ctx, event.object.id);
      return true;
    case "payment_intent.payment_failed":
      await onPaymentFailed(ctx, event.object);
      return true;
    case "payment_intent.canceled":
      await onPaymentCanceled(ctx, event.object.id);
      return true;
    case "refund.created":
    case "refund.updated":
      await onRefund(ctx, event.object);
      return true;
    case "charge.dispute.created":
      await onDispute(ctx, event.object);
      return true;
    case "setup_intent.succeeded":
      if (typeof event.object.payment_method === "string") {
        // A SetupIntent is only ever created after the resident consents to saving the card.
        await ctx.gateway.allowRedisplay(event.object.payment_method);
      }
      return true;
    default:
      return false;
  }
}

async function bookingForIntent(ctx: Ctx, metadataBookingId: string | undefined, paymentIntentId: string): Promise<Booking | null> {
  if (metadataBookingId) {
    const b = await ctx.store.getBooking(metadataBookingId);
    if (b) return b;
  }
  return ctx.store.findBookingByPaymentIntent(paymentIntentId);
}

/**
 * Confirms a booking only after re-reading the PaymentIntent from Stripe and
 * checking it is succeeded, for this booking's customer, in the right currency,
 * and for exactly the server-computed amount.
 */
async function onPaymentSucceeded(ctx: Ctx, paymentIntentId: string): Promise<void> {
  const nowIso = ctx.now().toISOString();
  const pi = await ctx.gateway.retrievePaymentIntent(paymentIntentId);
  const booking = await bookingForIntent(ctx, pi.metadata.bookingId, pi.id);
  if (!booking) {
    await ctx.store.audit({ at: nowIso, actor: "stripe", action: "payment-without-booking", detail: { paymentIntentId: pi.id, amount: pi.amountReceived } });
    return;
  }

  const problems: string[] = [];
  if (pi.status !== "succeeded") problems.push(`status ${pi.status}`);
  if (pi.amountReceived !== booking.price.totalCents) problems.push(`amount ${pi.amountReceived} != ${booking.price.totalCents}`);
  if (pi.currency !== booking.price.currency) problems.push(`currency ${pi.currency}`);
  if (pi.customerId !== booking.stripeCustomerId) problems.push("customer mismatch");
  if (booking.paymentIntentId && booking.paymentIntentId !== pi.id) problems.push("payment intent mismatch");
  if (problems.length) {
    // Never confirm on a mismatch. Leave it for the owner to resolve.
    await ctx.store.audit({ at: nowIso, actor: "stripe", action: "payment-verification-failed", bookingId: booking.id, detail: { paymentIntentId: pi.id, problems } });
    return;
  }

  const confirmed = await ctx.store.transitionBooking(booking.id, ["pending_payment"], {
    status: "confirmed",
    paidAt: nowIso,
    paymentIntentId: pi.id,
    updatedAt: nowIso,
  });

  if (confirmed) {
    await ctx.store.audit({ at: nowIso, actor: "stripe", action: "booking-confirmed", bookingId: booking.id, detail: { paymentIntentId: pi.id, amount: pi.amountReceived } });
    if (confirmed.saveCardConsent && pi.paymentMethodId) await ctx.gateway.allowRedisplay(pi.paymentMethodId);
    return;
  }

  const current = await ctx.store.getBooking(booking.id);
  if (current && (current.status === "expired" || current.status === "payment_failed" || current.status === "canceled")) {
    // Paid after the hold was released, so the night may now be full. Refund in full.
    await refundLatePayment(ctx, current);
  }
  // Already confirmed (or further along): a repeat delivery, nothing to do.
}

async function onPaymentFailed(ctx: Ctx, object: Record<string, any>): Promise<void> {
  // The resident can retry with another card on the same PaymentIntent, so the
  // hold stays until it expires. Only record what happened.
  const booking = await bookingForIntent(ctx, object.metadata?.bookingId, object.id);
  await ctx.store.audit({
    at: ctx.now().toISOString(),
    actor: "stripe",
    action: "payment-failed",
    bookingId: booking?.id,
    detail: { paymentIntentId: object.id, code: object.last_payment_error?.code, declineCode: object.last_payment_error?.decline_code },
  });
}

async function onPaymentCanceled(ctx: Ctx, paymentIntentId: string): Promise<void> {
  const pi = await ctx.gateway.retrievePaymentIntent(paymentIntentId);
  const booking = await bookingForIntent(ctx, pi.metadata.bookingId, pi.id);
  if (!booking) return;
  const nowIso = ctx.now().toISOString();
  const done = await ctx.store.transitionBooking(booking.id, ["pending_payment"], { status: "expired", updatedAt: nowIso });
  if (done) await ctx.store.audit({ at: nowIso, actor: "stripe", action: "payment-canceled", bookingId: booking.id });
}

async function onRefund(ctx: Ctx, refund: Record<string, any>): Promise<void> {
  const piId: string | undefined = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (!piId) return;
  const booking = await bookingForIntent(ctx, refund.metadata?.bookingId, piId);
  if (!booking) return;
  const nowIso = ctx.now().toISOString();
  const requestId: string | undefined = refund.metadata?.refundRequestId;

  if (refund.status === "succeeded") {
    await ctx.store.applyRefund(booking.id, refund.id, refund.amount);
    if (requestId) await ctx.store.transitionRefundRequest(requestId, ["approved", "refunded"], { status: "refunded", stripeRefundId: refund.id, updatedAt: nowIso });
    await ctx.store.audit({ at: nowIso, actor: "stripe", action: "refund-succeeded", bookingId: booking.id, refundRequestId: requestId, detail: { refundId: refund.id, amount: refund.amount } });
  } else if (refund.status === "failed" || refund.status === "canceled") {
    if (requestId) await ctx.store.transitionRefundRequest(requestId, ["approved", "refunded"], { status: "failed", updatedAt: nowIso });
    await ctx.store.audit({ at: nowIso, actor: "stripe", action: "refund-failed", bookingId: booking.id, refundRequestId: requestId, detail: { refundId: refund.id, reason: refund.failure_reason } });
  }
}

async function onDispute(ctx: Ctx, dispute: Record<string, any>): Promise<void> {
  const piId: string | undefined = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
  if (!piId) return;
  const booking = await ctx.store.findBookingByPaymentIntent(piId);
  if (!booking) return;
  const nowIso = ctx.now().toISOString();
  await ctx.store.transitionBooking(booking.id, [booking.status], { disputed: true, updatedAt: nowIso });
  await ctx.store.audit({ at: nowIso, actor: "stripe", action: "dispute-opened", bookingId: booking.id, detail: { disputeId: dispute.id, reason: dispute.reason, amount: dispute.amount } });
}
