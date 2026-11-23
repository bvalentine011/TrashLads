import { describe, expect, it } from "vitest";
import { createBookingPayment } from "../src/services/booking";
import { ownerSetBookingStatus, ownerStartRoute } from "../src/services/ownerRoute";
import { handleWebhookEvent } from "../src/services/webhook";
import { addUser, bookingRequest, event, setup } from "./fakes";

async function night() {
  const s = setup();
  const ids: string[] = [];
  for (const [uid, unit] of [["u_a", "203"], ["u_b", "204"], ["u_c", "207"]] as const) {
    const who = uid === "u_a" ? s.resident : addUser(s.store, uid, true);
    const res = await createBookingPayment(s.ctx, who, bookingRequest({ unitLabel: unit }));
    ids.push(res.bookingId);
  }
  // Pay the first two; the third stays unpaid.
  for (const id of ids.slice(0, 2)) {
    const pi = s.store.bookings.get(id)!.paymentIntentId!;
    s.gateway.pay(pi);
    await handleWebhookEvent(s.ctx, event("payment_intent.succeeded", { id: pi }));
  }
  return { ...s, ids };
}

describe("owner route actions", () => {
  it("starts the route for confirmed pickups only", async () => {
    const { ctx, store, owner, ids } = await night();
    expect(await ownerStartRoute(ctx, owner, { serviceDate: "2026-11-24" })).toEqual({ started: 2 });
    expect(ids.map((id) => store.bookings.get(id)!.status)).toEqual(["in_progress", "in_progress", "pending_payment"]);
  });

  it("completes, marks missed with a note, and undoes", async () => {
    const { ctx, store, owner, ids } = await night();
    await ownerSetBookingStatus(ctx, owner, { bookingId: ids[0], status: "completed" });
    expect(store.bookings.get(ids[0])!.completedAt).toBeTruthy();
    await expect(ownerSetBookingStatus(ctx, owner, { bookingId: ids[1], status: "missed" })).rejects.toThrow(/note/);
    await ownerSetBookingStatus(ctx, owner, { bookingId: ids[1], status: "missed", note: "Bags not out at 9 PM" });
    expect(store.bookings.get(ids[1])).toMatchObject({ status: "missed", ownerNote: "Bags not out at 9 PM" });
    await ownerSetBookingStatus(ctx, owner, { bookingId: ids[0], status: "confirmed" });
    expect(store.bookings.get(ids[0])!.status).toBe("confirmed");
  });

  it("can't put an unpaid booking on the route or skip states", async () => {
    const { ctx, owner, ids } = await night();
    await expect(ownerSetBookingStatus(ctx, owner, { bookingId: ids[2], status: "completed" })).rejects.toThrow(/pending payment/);
    await expect(ownerSetBookingStatus(ctx, owner, { bookingId: ids[0], status: "pending_payment" })).rejects.toThrow(/can't be set/);
  });

  it("frees the slot when the owner cancels", async () => {
    const { ctx, store, owner, ids } = await night();
    await ownerSetBookingStatus(ctx, owner, { bookingId: ids[0], status: "canceled" });
    expect(store.nights.get("2026-11-24")!.stops).toBe(2);
  });

  it("is owner-only", async () => {
    const { ctx, resident, ids } = await night();
    await expect(ownerSetBookingStatus(ctx, resident, { bookingId: ids[0], status: "completed" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(ownerStartRoute(ctx, resident, { serviceDate: "2026-11-24" })).rejects.toMatchObject({ code: "permission-denied" });
  });
});
