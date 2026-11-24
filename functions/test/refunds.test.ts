import { describe, expect, it } from "vitest";
import { createBookingPayment } from "../src/services/booking";
import { cancelBooking, ownerRefund, requestRefundException, reviewRefundRequest } from "../src/services/refunds";
import { handleWebhookEvent } from "../src/services/webhook";
import { addUser, bookingRequest, event, setup } from "./fakes";

async function paid(serviceDate = "2026-11-24") {
  const s = setup();
  const res = await createBookingPayment(s.ctx, s.resident, bookingRequest({ serviceDate }));
  const piId = s.store.bookings.get(res.bookingId)!.paymentIntentId!;
  s.gateway.pay(piId);
  await handleWebhookEvent(s.ctx, event("payment_intent.succeeded", { id: piId }));
  /** Replays what Stripe sends after a refund succeeds. */
  const settle = async () => {
    for (const r of s.gateway.refunds) {
      await handleWebhookEvent(s.ctx, event("refund.updated", { id: r.id, status: "succeeded", amount: r.amount, payment_intent: piId, metadata: r.metadata }, `evt_${r.id}`));
    }
  };
  return { ...s, bookingId: res.bookingId, piId, settle };
}

describe("resident cancellation", () => {
  it("refunds in full and frees the slot before 5 PM on the pickup date", async () => {
    const { ctx, store, gateway, resident, bookingId, settle } = await paid();
    const res = await cancelBooking(ctx, resident, bookingId);
    expect(res.canceled).toBe(true);
    expect(gateway.refunds).toEqual([expect.objectContaining({ amount: 1400 })]);
    await settle();
    const b = store.bookings.get(bookingId)!;
    expect(b).toMatchObject({ status: "canceled", amountRefundedCents: 1400, refundState: "full" });
    expect(store.refunds.get(res.refundRequestId!)!.status).toBe("refunded");
    expect(store.nights.get("2026-11-24")).toEqual({ stops: 0, bags: 0 });
  });

  it("doesn't cancel or refund after the cutoff", async () => {
    const { ctx, store, gateway, clock, resident, bookingId } = await paid("2026-11-23");
    clock.now = new Date("2026-11-23T22:30:00Z"); // 5:30 PM Eastern
    expect(await cancelBooking(ctx, resident, bookingId)).toEqual({ canceled: false, reason: "cutoff-passed" });
    expect(store.bookings.get(bookingId)!.status).toBe("confirmed");
    expect(gateway.refunds).toHaveLength(0);
  });

  it("won't let one resident cancel another's booking", async () => {
    const { ctx, store, bookingId } = await paid();
    const stranger = addUser(store, "u_stranger", true);
    await expect(cancelBooking(ctx, stranger, bookingId)).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("owner-reviewed exceptions", () => {
  it("holds a late request for review, then refunds the approved partial amount", async () => {
    const { ctx, store, gateway, clock, resident, owner, bookingId, settle } = await paid("2026-11-23");
    clock.now = new Date("2026-11-24T05:00:00Z"); // after the pickup night
    const { refundRequestId } = await requestRefundException(ctx, resident, { bookingId, reason: "Only one of my two bags was taken." });
    expect(store.refunds.get(refundRequestId)!.status).toBe("pending_review");
    expect(gateway.refunds).toHaveLength(0);
    await expect(requestRefundException(ctx, resident, { bookingId, reason: "Asking a second time please" })).rejects.toMatchObject({ code: "already-exists" });

    await expect(reviewRefundRequest(ctx, resident, { refundRequestId, decision: "approve" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(reviewRefundRequest(ctx, owner, { refundRequestId, decision: "approve", amountCents: 5000 })).rejects.toThrow(/most you can refund is \$14.00/);

    await reviewRefundRequest(ctx, owner, { refundRequestId, decision: "approve", amountCents: 300, note: "One bag missed" });
    expect(gateway.refunds).toEqual([expect.objectContaining({ amount: 300 })]);
    await settle();
    expect(store.bookings.get(bookingId)).toMatchObject({ amountRefundedCents: 300, refundState: "partial" });
    expect(store.refunds.get(refundRequestId)).toMatchObject({ status: "refunded", reviewedBy: "u_owner", approvedCents: 300 });
  });

  it("requires a reason to deny, and denying sends no refund", async () => {
    const { ctx, store, gateway, resident, owner, bookingId } = await paid();
    const { refundRequestId } = await requestRefundException(ctx, resident, { bookingId, reason: "Changed my mind about it" });
    await expect(reviewRefundRequest(ctx, owner, { refundRequestId, decision: "deny" })).rejects.toThrow(/reason/);
    await reviewRefundRequest(ctx, owner, { refundRequestId, decision: "deny", note: "Cancel before 5 PM next time." });
    expect(store.refunds.get(refundRequestId)!.status).toBe("denied");
    expect(gateway.refunds).toHaveLength(0);
    await expect(reviewRefundRequest(ctx, owner, { refundRequestId, decision: "approve" })).rejects.toThrow(/already been reviewed/);
  });

  it("lets the owner refund a missed pickup directly, never beyond what was paid", async () => {
    const { ctx, store, gateway, owner, resident, bookingId, settle } = await paid();
    await expect(ownerRefund(ctx, resident, { bookingId, reason: "trying" })).rejects.toMatchObject({ code: "permission-denied" });
    await ownerRefund(ctx, owner, { bookingId, amountCents: 1000, reason: "Crew missed the stop" });
    await settle();
    await expect(ownerRefund(ctx, owner, { bookingId, amountCents: 500, reason: "Again" })).rejects.toThrow(/most you can refund is \$4.00/);
    await ownerRefund(ctx, owner, { bookingId, reason: "Rest of it" });
    await settle();
    expect(store.bookings.get(bookingId)).toMatchObject({ amountRefundedCents: 1400, refundState: "full" });
    expect(gateway.refunds.map((r) => r.amount)).toEqual([1000, 400]);
    expect(store.actions().filter((a) => a === "owner-refund")).toHaveLength(2);
  });

  it("counts each Stripe refund once even if its webhook repeats", async () => {
    const { ctx, store, owner, bookingId, settle } = await paid();
    await ownerRefund(ctx, owner, { bookingId, amountCents: 500, reason: "Partial credit" });
    await settle();
    store.events.clear(); // simulate a redelivery with a new event id
    await settle();
    expect(store.bookings.get(bookingId)!.amountRefundedCents).toBe(500);
  });
});
