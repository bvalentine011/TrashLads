import { randomUUID } from "node:crypto";
import { isBeforeCancelCutoff } from "../dates";
import { AppError } from "../domain/errors";
import type { Booking, RefundRequest } from "../domain/types";
import type { Caller, Ctx } from "./context";

/**
 * Refund policy
 * 1. Resident cancels before 5 PM Eastern on the pickup date: full automatic refund.
 * 2. After the cutoff, or after a completed or missed pickup: the resident can ask
 *    for an exception. It waits for the owner, who approves (full or partial) or denies.
 * 3. The owner can refund any paid booking on their own (for example, a pickup
 *    the crew missed). Every refund is capped at what's left to refund and logged.
 */

const PAID_STATUSES: Booking["status"][] = ["confirmed", "in_progress", "completed", "missed", "canceled"];

function refundableCents(b: Booking): number {
  if (!b.paidAt) return 0;
  return Math.max(0, b.price.totalCents - b.amountRefundedCents);
}

async function loadOwnBooking(ctx: Ctx, caller: Caller, bookingId: unknown): Promise<Booking> {
  if (typeof bookingId !== "string" || !bookingId) throw new AppError("invalid-argument", "Missing booking.");
  const b = await ctx.store.getBooking(bookingId);
  if (!b || (b.uid !== caller.uid && !caller.isOwner)) throw new AppError("not-found", "Booking not found.");
  return b;
}

async function issueRefund(ctx: Ctx, booking: Booking, request: RefundRequest, amountCents: number): Promise<RefundRequest> {
  if (!booking.paymentIntentId) throw new AppError("failed-precondition", "This booking has no payment to refund.");
  const nowIso = ctx.now().toISOString();
  try {
    const refund = await ctx.gateway.createRefund(
      {
        paymentIntentId: booking.paymentIntentId,
        amountCents,
        metadata: { bookingId: booking.id, refundRequestId: request.id, origin: request.origin },
      },
      `refund-${request.id}`,
    );
    // The refund.* webhook applies the amount to the booking once Stripe reports success.
    return (
      (await ctx.store.transitionRefundRequest(request.id, ["approved"], { stripeRefundId: refund.id, updatedAt: nowIso })) ?? request
    );
  } catch (err) {
    await ctx.store.transitionRefundRequest(request.id, ["approved"], { status: "failed", updatedAt: nowIso });
    await ctx.store.audit({ at: nowIso, actor: "system", action: "refund-create-failed", bookingId: booking.id, refundRequestId: request.id, detail: { message: (err as Error).message } });
    throw new AppError("internal", "The refund couldn't be sent to Stripe. It's marked as failed for the owner to retry.");
  }
}

function newRequest(booking: Booking, origin: RefundRequest["origin"], reason: string, requestedCents: number, status: RefundRequest["status"], nowIso: string, extra: Partial<RefundRequest> = {}): RefundRequest {
  return { id: `rr_${randomUUID()}`, bookingId: booking.id, uid: booking.uid, origin, reason, requestedCents, status, createdAt: nowIso, updatedAt: nowIso, ...extra };
}

/** Resident cancels. Before the cutoff this refunds in full; after it, nothing is canceled. */
export async function cancelBooking(ctx: Ctx, caller: Caller, bookingId: unknown): Promise<{ canceled: boolean; refundRequestId?: string; reason?: string }> {
  const booking = await loadOwnBooking(ctx, caller, bookingId);
  const now = ctx.now();
  const nowIso = now.toISOString();

  if (booking.status === "pending_payment") {
    if (booking.paymentIntentId) {
      const pi = await ctx.gateway.retrievePaymentIntent(booking.paymentIntentId);
      if (pi.status === "succeeded" || pi.status === "processing") {
        throw new AppError("failed-precondition", "Your payment is being confirmed. Try again in a minute.", "payment-processing");
      }
      if (pi.status !== "canceled") await ctx.gateway.cancelPaymentIntent(booking.paymentIntentId);
    }
    await ctx.store.transitionBooking(booking.id, ["pending_payment"], { status: "expired", updatedAt: nowIso });
    return { canceled: true };
  }

  if (booking.status !== "confirmed") {
    throw new AppError("failed-precondition", "This pickup can't be canceled.", `booking-${booking.status}`);
  }
  if (!isBeforeCancelCutoff(booking.serviceDate, now)) {
    return { canceled: false, reason: "cutoff-passed" };
  }

  const canceled = await ctx.store.transitionBooking(booking.id, ["confirmed"], { status: "canceled", updatedAt: nowIso });
  if (!canceled) throw new AppError("failed-precondition", "This pickup changed. Reload and try again.");
  await ctx.store.audit({ at: nowIso, actor: caller.uid, action: "booking-canceled-by-customer", bookingId: booking.id });

  const amount = refundableCents(canceled);
  if (amount === 0) return { canceled: true };
  const request = newRequest(canceled, "customer_cancel", "Canceled before the cutoff", amount, "approved", nowIso, { approvedCents: amount, reviewedBy: "policy" });
  await ctx.store.createRefundRequest(request);
  await issueRefund(ctx, canceled, request, amount);
  return { canceled: true, refundRequestId: request.id };
}

/** Resident asks for an exception after the cutoff. Waits for owner review. */
export async function requestRefundException(ctx: Ctx, caller: Caller, input: { bookingId?: unknown; reason?: unknown }): Promise<{ refundRequestId: string }> {
  const booking = await loadOwnBooking(ctx, caller, input.bookingId);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 10 || reason.length > 1000) throw new AppError("invalid-argument", "Tell us what happened in at least 10 characters.");
  if (!PAID_STATUSES.includes(booking.status)) throw new AppError("failed-precondition", "There's no payment on this pickup to refund.");
  const amount = refundableCents(booking);
  if (amount === 0) throw new AppError("failed-precondition", "This pickup has already been refunded.");
  if (await ctx.store.openRefundRequestFor(booking.id)) {
    throw new AppError("already-exists", "There's already a refund request for this pickup.");
  }
  const nowIso = ctx.now().toISOString();
  const request = newRequest(booking, "customer_exception", reason, amount, "pending_review", nowIso);
  await ctx.store.createRefundRequest(request);
  await ctx.store.audit({ at: nowIso, actor: caller.uid, action: "refund-exception-requested", bookingId: booking.id, refundRequestId: request.id });
  return { refundRequestId: request.id };
}

function requireOwner(caller: Caller): void {
  if (!caller.isOwner) throw new AppError("permission-denied", "Only the owner can do this.");
}

function checkAmount(amount: unknown, max: number): number {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) throw new AppError("invalid-argument", "Enter a refund amount in cents.");
  if (amount > max) throw new AppError("invalid-argument", `The most you can refund is $${(max / 100).toFixed(2)}.`);
  return amount;
}

/** Owner approves (full or partial) or denies a resident's exception request. */
export async function reviewRefundRequest(
  ctx: Ctx,
  caller: Caller,
  input: { refundRequestId?: unknown; decision?: unknown; amountCents?: unknown; note?: unknown },
): Promise<RefundRequest> {
  requireOwner(caller);
  if (typeof input.refundRequestId !== "string") throw new AppError("invalid-argument", "Missing refund request.");
  const request = await ctx.store.getRefundRequest(input.refundRequestId);
  if (!request) throw new AppError("not-found", "Refund request not found.");
  if (request.status !== "pending_review") throw new AppError("failed-precondition", "This request has already been reviewed.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  const nowIso = ctx.now().toISOString();

  if (input.decision === "deny") {
    if (note.length < 5) throw new AppError("invalid-argument", "Add a short reason for the resident.");
    const denied = await ctx.store.transitionRefundRequest(request.id, ["pending_review"], { status: "denied", reviewedBy: caller.uid, reviewNote: note, updatedAt: nowIso });
    await ctx.store.audit({ at: nowIso, actor: caller.uid, action: "refund-denied", bookingId: request.bookingId, refundRequestId: request.id, detail: { note } });
    return denied!;
  }
  if (input.decision !== "approve") throw new AppError("invalid-argument", "Choose approve or deny.");

  const booking = await ctx.store.getBooking(request.bookingId);
  if (!booking) throw new AppError("not-found", "Booking not found.");
  const amount = checkAmount(input.amountCents ?? refundableCents(booking), refundableCents(booking));
  const approved = await ctx.store.transitionRefundRequest(request.id, ["pending_review"], { status: "approved", approvedCents: amount, reviewedBy: caller.uid, reviewNote: note, updatedAt: nowIso });
  if (!approved) throw new AppError("failed-precondition", "This request changed. Reload and try again.");
  await ctx.store.audit({ at: nowIso, actor: caller.uid, action: "refund-approved", bookingId: booking.id, refundRequestId: request.id, detail: { amount } });
  return issueRefund(ctx, booking, approved, amount);
}

/** Owner refunds a paid booking directly, e.g. when the crew missed a pickup. */
export async function ownerRefund(
  ctx: Ctx,
  caller: Caller,
  input: { bookingId?: unknown; amountCents?: unknown; reason?: unknown },
): Promise<RefundRequest> {
  requireOwner(caller);
  const booking = await loadOwnBooking(ctx, caller, input.bookingId);
  if (!PAID_STATUSES.includes(booking.status)) throw new AppError("failed-precondition", "There's no payment on this pickup to refund.");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 5) throw new AppError("invalid-argument", "Add a reason for the refund.");
  const amount = checkAmount(input.amountCents ?? refundableCents(booking), refundableCents(booking));
  const nowIso = ctx.now().toISOString();
  const request = newRequest(booking, "owner", reason, amount, "approved", nowIso, { approvedCents: amount, reviewedBy: caller.uid });
  await ctx.store.createRefundRequest(request);
  await ctx.store.audit({ at: nowIso, actor: caller.uid, action: "owner-refund", bookingId: booking.id, refundRequestId: request.id, detail: { amount, reason } });
  return issueRefund(ctx, booking, request, amount);
}

/** Used by the webhook when money arrives after the hold was released. */
export async function refundLatePayment(ctx: Ctx, booking: Booking): Promise<void> {
  const nowIso = ctx.now().toISOString();
  if (!booking.paymentIntentId) return;
  const pi = await ctx.gateway.retrievePaymentIntent(booking.paymentIntentId);
  const amount = pi.amountReceived - booking.amountRefundedCents;
  if (amount <= 0) return;
  // A deterministic id makes a repeat webhook reuse the same Stripe refund.
  const request: RefundRequest = {
    id: `rr_late_${booking.id}`,
    bookingId: booking.id,
    uid: booking.uid,
    origin: "owner",
    reason: "Payment arrived after the booking hold expired",
    requestedCents: amount,
    approvedCents: amount,
    status: "approved",
    reviewedBy: "policy",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (!(await ctx.store.getRefundRequest(request.id))) await ctx.store.createRefundRequest(request);
  await ctx.store.audit({ at: nowIso, actor: "system", action: "late-payment-refunded", bookingId: booking.id, refundRequestId: request.id, detail: { amount } });
  await ctx.gateway.createRefund(
    { paymentIntentId: booking.paymentIntentId, amountCents: amount, metadata: { bookingId: booking.id, refundRequestId: request.id, origin: "late-payment" } },
    `refund-${request.id}`,
  );
}
