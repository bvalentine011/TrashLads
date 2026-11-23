import { describe, expect, it } from "vitest";
import { TERMS } from "../src/config";
import { createBookingPayment } from "../src/services/booking";
import { handleWebhookEvent } from "../src/services/webhook";
import { bookingRequest, event, setup } from "./fakes";

async function booked(extra: Record<string, unknown> = {}) {
  const s = setup();
  const res = await createBookingPayment(s.ctx, s.resident, bookingRequest(extra));
  const piId = s.store.bookings.get(res.bookingId)!.paymentIntentId!;
  return { ...s, bookingId: res.bookingId, piId };
}

describe("payment_intent.succeeded", () => {
  it("confirms the booking only after re-reading a succeeded PaymentIntent from Stripe", async () => {
    const { ctx, store, gateway, bookingId, piId } = await booked();
    // A forged or early event: the intent hasn't actually succeeded.
    await handleWebhookEvent(ctx, event("payment_intent.succeeded", { id: piId, status: "succeeded", metadata: { bookingId } }));
    expect(store.bookings.get(bookingId)!.status).toBe("pending_payment");
    expect(store.actions()).toContain("payment-verification-failed");

    gateway.pay(piId);
    await handleWebhookEvent(ctx, event("payment_intent.succeeded", { id: piId }));
    const b = store.bookings.get(bookingId)!;
    expect(b.status).toBe("confirmed");
    expect(b.paidAt).toBeTruthy();
  });

  it("never confirms when the amount paid doesn't match the server price", async () => {
    const { ctx, store, gateway, bookingId, piId } = await booked();
    gateway.pay(piId, { amount: 100 });
    await handleWebhookEvent(ctx, event("payment_intent.succeeded", { id: piId }));
    expect(store.bookings.get(bookingId)!.status).toBe("pending_payment");
    const audit = store.auditLog.find((a) => a.action === "payment-verification-failed")!;
    expect(audit.detail!.problems).toEqual(["amount 100 != 1400"]);
  });

  it("processes each event id once, even when Stripe delivers it again", async () => {
    const { ctx, store, gateway, bookingId, piId } = await booked();
    gateway.pay(piId);
    const e = event("payment_intent.succeeded", { id: piId }, "evt_same");
    expect(await handleWebhookEvent(ctx, e)).toBe("processed");
    expect(await handleWebhookEvent(ctx, e)).toBe("duplicate");
    expect(store.actions().filter((a) => a === "booking-confirmed")).toHaveLength(1);
    // A different event for the same payment is also harmless.
    await handleWebhookEvent(ctx, event("payment_intent.succeeded", { id: piId }));
    expect(store.actions().filter((a) => a === "booking-confirmed")).toHaveLength(1);
    expect(store.bookings.get(bookingId)!.status).toBe("confirmed");
  });

  it("releases the event claim on failure so Stripe's retry can process it", async () => {
    const { ctx, store, gateway, piId } = await booked();
    gateway.pay(piId);
    const original = gateway.retrievePaymentIntent.bind(gateway);
    gateway.retrievePaymentIntent = async () => { throw new Error("network"); };
    const e = event("payment_intent.succeeded", { id: piId }, "evt_retry");
    await expect(handleWebhookEvent(ctx, e)).rejects.toThrow("network");
    expect(store.events.has("evt_retry")).toBe(false);
    gateway.retrievePaymentIntent = original;
    expect(await handleWebhookEvent(ctx, e)).toBe("processed");
  });

  it("ignores events from the other Stripe mode", async () => {
    const { ctx, store, gateway, bookingId, piId } = await booked();
    gateway.pay(piId);
    const live = { ...event("payment_intent.succeeded", { id: piId }), livemode: true };
    expect(await handleWebhookEvent(ctx, live)).toBe("ignored");
    expect(store.bookings.get(bookingId)!.status).toBe("pending_payment");
  });

  it("marks a saved card for redisplay only when the resident consented", async () => {
    const withConsent = await booked({ saveCardConsentVersion: TERMS.savedCardConsentVersion });
    withConsent.gateway.pay(withConsent.piId, { pm: "pm_saved" });
    await handleWebhookEvent(withConsent.ctx, event("payment_intent.succeeded", { id: withConsent.piId }));
    expect(withConsent.gateway.methods.get("pm_saved")!.allowRedisplay).toBe(true);

    const without = await booked();
    without.gateway.pay(without.piId, { pm: "pm_once" });
    await handleWebhookEvent(without.ctx, event("payment_intent.succeeded", { id: without.piId }));
    expect(without.gateway.methods.get("pm_once")!.allowRedisplay).toBe(false);
  });

  it("refunds in full when payment lands after the hold was released", async () => {
    const { ctx, store, gateway, bookingId, piId } = await booked();
    await store.transitionBooking(bookingId, ["pending_payment"], { status: "expired" });
    gateway.pay(piId);
    await handleWebhookEvent(ctx, event("payment_intent.succeeded", { id: piId }));
    expect(store.bookings.get(bookingId)!.status).toBe("expired");
    expect(gateway.refunds).toEqual([expect.objectContaining({ paymentIntentId: piId, amount: 1400 })]);
    // A repeat delivery reuses the same refund instead of refunding twice.
    await handleWebhookEvent(ctx, event("payment_intent.succeeded", { id: piId }));
    expect(gateway.refunds).toHaveLength(1);
  });
});

describe("other payment events", () => {
  it("keeps the hold after a decline so the resident can try another card", async () => {
    const { ctx, store, bookingId, piId } = await booked();
    await handleWebhookEvent(ctx, event("payment_intent.payment_failed", { id: piId, metadata: { bookingId }, last_payment_error: { code: "card_declined", decline_code: "insufficient_funds" } }));
    expect(store.bookings.get(bookingId)!.status).toBe("pending_payment");
    expect(store.auditLog.at(-1)).toMatchObject({ action: "payment-failed", detail: { declineCode: "insufficient_funds" } });
  });

  it("releases capacity when the PaymentIntent is canceled", async () => {
    const { ctx, store, gateway, bookingId, piId } = await booked();
    await gateway.cancelPaymentIntent(piId);
    await handleWebhookEvent(ctx, event("payment_intent.canceled", { id: piId }));
    expect(store.bookings.get(bookingId)!.status).toBe("expired");
    expect(store.nights.get("2026-11-24")).toEqual({ stops: 0, bags: 0 });
  });

  it("records disputes on the booking", async () => {
    const { ctx, store, gateway, bookingId, piId } = await booked();
    gateway.pay(piId);
    await handleWebhookEvent(ctx, event("payment_intent.succeeded", { id: piId }));
    await handleWebhookEvent(ctx, event("charge.dispute.created", { id: "dp_1", payment_intent: piId, reason: "fraudulent", amount: 1400 }));
    expect(store.bookings.get(bookingId)!.disputed).toBe(true);
    expect(store.bookings.get(bookingId)!.status).toBe("confirmed");
  });
});
