import { describe, expect, it } from "vitest";
import { CAPACITY, TERMS } from "../src/config";
import { createBookingPayment, expireHolds } from "../src/services/booking";
import { acceptRegistrationTerms } from "../src/services/terms";
import { addUser, bookingRequest, setup } from "./fakes";

describe("createBookingPayment: server-side checks", () => {
  it("creates a held booking and a PaymentIntent for the server's price", async () => {
    const { ctx, store, gateway, resident } = setup();
    const res = await createBookingPayment(ctx, resident, bookingRequest({ bagCount: 3, price: 1, totalCents: 1 }));
    expect(res.price.totalCents).toBe(1700);
    const b = store.bookings.get(res.bookingId)!;
    expect(b.status).toBe("pending_payment");
    expect(b.paidAt).toBeUndefined();
    const pi = gateway.intents.get(b.paymentIntentId!)!;
    expect(pi.amount).toBe(1700);
    expect(pi.currency).toBe("usd");
    expect(pi.customerId).toBe(store.users.get(resident.uid)!.stripeCustomerId);
    expect(pi.setupFutureUsage).toBe(false);
    expect(store.nights.get("2026-11-24")).toEqual({ stops: 1, bags: 3 });
  });

  it("requires current registration terms, accepted through the server", async () => {
    const { ctx, store } = setup();
    const newbie = addUser(store, "u_new", false);
    await expect(createBookingPayment(ctx, newbie, bookingRequest())).rejects.toMatchObject({ reason: "registration-terms-required" });
    await expect(acceptRegistrationTerms(ctx, newbie, "2020-01-01")).rejects.toMatchObject({ reason: "terms-outdated" });
    await acceptRegistrationTerms(ctx, newbie, TERMS.registrationTermsVersion);
    await expect(createBookingPayment(ctx, newbie, bookingRequest())).resolves.toBeTruthy();
  });

  it("requires the separate service terms and the placement rules", async () => {
    const { ctx, resident } = setup();
    await expect(createBookingPayment(ctx, resident, bookingRequest({ acceptedServiceTermsVersion: undefined }))).rejects.toMatchObject({ reason: "service-terms-required" });
    await expect(createBookingPayment(ctx, resident, bookingRequest({ acceptedServiceTermsVersion: "old" }))).rejects.toMatchObject({ reason: "service-terms-required" });
    await expect(createBookingPayment(ctx, resident, bookingRequest({ acceptedPlacementPolicy: false }))).rejects.toMatchObject({ reason: "placement-policy-required" });
  });

  it("refuses communities that aren't approved or don't exist", async () => {
    const { ctx, resident } = setup();
    await expect(createBookingPayment(ctx, resident, bookingRequest({ propertyId: "placeholder-pointe" }))).rejects.toMatchObject({ reason: "property-not-served" });
    await expect(createBookingPayment(ctx, resident, bookingRequest({ propertyId: "nowhere" }))).rejects.toMatchObject({ reason: "property-not-served" });
  });

  it("rejects bad bag counts, dates and contact details", async () => {
    const { ctx, resident } = setup();
    await expect(createBookingPayment(ctx, resident, bookingRequest({ bagCount: 4 }))).rejects.toThrow(/1, 2 or 3/);
    await expect(createBookingPayment(ctx, resident, bookingRequest({ serviceDate: "2026-11-28" }))).rejects.toMatchObject({ reason: "date-weekend" });
    await expect(createBookingPayment(ctx, resident, bookingRequest({ contact: { name: "A B", phone: "12345" } }))).rejects.toThrow(/10-digit/);
    await expect(createBookingPayment(ctx, resident, bookingRequest({ unitLabel: "<script>" }))).rejects.toThrow(/unit/);
  });

  it("flags units the community hasn't listed, for the owner to check", async () => {
    const { ctx, store, resident } = setup();
    const known = await createBookingPayment(ctx, resident, bookingRequest());
    const other = addUser(store, "u_two", true);
    const unknown = await createBookingPayment(ctx, other, bookingRequest({ unitLabel: "999" }));
    expect(store.bookings.get(known.bookingId)!.locationUnverified).toBe(false);
    expect(store.bookings.get(unknown.bookingId)!.locationUnverified).toBe(true);
  });

  it("enforces stop capacity per night", async () => {
    const { ctx, store } = setup();
    for (let i = 0; i < CAPACITY.maxStopsPerNight; i++) {
      const u = addUser(store, `u_${i}`, true);
      await createBookingPayment(ctx, u, bookingRequest({ unitLabel: `${100 + i}`, bagCount: 1 }));
    }
    const late = addUser(store, "u_late", true);
    await expect(createBookingPayment(ctx, late, bookingRequest({ unitLabel: "500", bagCount: 1 }))).rejects.toMatchObject({ reason: "night-full" });
    expect(store.nights.get("2026-11-24")!.stops).toBe(CAPACITY.maxStopsPerNight);
  });

  it("enforces bag capacity per night", async () => {
    const { ctx, store } = setup();
    for (let i = 0; i < 20; i++) {
      const u = addUser(store, `u_${i}`, true);
      await createBookingPayment(ctx, u, bookingRequest({ unitLabel: `${100 + i}`, bagCount: 3 }));
    }
    const late = addUser(store, "u_late", true);
    await expect(createBookingPayment(ctx, late, bookingRequest({ unitLabel: "500", bagCount: 1 }))).rejects.toMatchObject({ reason: "night-full" });
  });

  it("allows one active booking per unit per night", async () => {
    const { ctx, store, resident } = setup();
    await createBookingPayment(ctx, resident, bookingRequest());
    const roommate = addUser(store, "u_roommate", true);
    await expect(createBookingPayment(ctx, roommate, bookingRequest())).rejects.toMatchObject({ reason: "unit-already-booked" });
  });

  it("is idempotent for retries of the same checkout", async () => {
    const { ctx, store, gateway, resident } = setup();
    const req = bookingRequest();
    const a = await createBookingPayment(ctx, resident, req);
    const b = await createBookingPayment(ctx, resident, req);
    expect(b.bookingId).toBe(a.bookingId);
    expect(b.clientSecret).toBe(a.clientSecret);
    expect(gateway.intents.size).toBe(1);
    expect(gateway.customers).toHaveLength(1);
    expect(store.nights.get("2026-11-24")!.stops).toBe(1);
  });

  it("sets up the card for future use only with explicit, current consent", async () => {
    const { ctx, store, gateway, resident } = setup();
    await expect(createBookingPayment(ctx, resident, bookingRequest({ saveCardConsentVersion: "old" }))).rejects.toMatchObject({ reason: "save-card-consent-outdated" });
    const res = await createBookingPayment(ctx, resident, bookingRequest({ saveCardConsentVersion: TERMS.savedCardConsentVersion }));
    const b = store.bookings.get(res.bookingId)!;
    expect(gateway.intents.get(b.paymentIntentId!)!.setupFutureUsage).toBe(true);
    expect(b.saveCardConsent?.version).toBe(TERMS.savedCardConsentVersion);
  });

  it("gives capacity back if Stripe can't create the payment", async () => {
    const { ctx, store, gateway, resident } = setup();
    gateway.failNextPaymentIntent = true;
    await expect(createBookingPayment(ctx, resident, bookingRequest())).rejects.toThrow(/unavailable/);
    expect(store.nights.get("2026-11-24")).toEqual({ stops: 0, bags: 0 });
    expect([...store.bookings.values()][0].status).toBe("expired");
  });
});

describe("expireHolds", () => {
  it("releases unpaid holds after 30 minutes and cancels their PaymentIntents", async () => {
    const { ctx, store, gateway, clock, resident } = setup();
    const res = await createBookingPayment(ctx, resident, bookingRequest());
    expect((await expireHolds(ctx)).expired).toBe(0);
    clock.now = new Date(clock.now.getTime() + 31 * 60_000);
    expect(await expireHolds(ctx)).toEqual({ expired: 1, skipped: 0 });
    const b = store.bookings.get(res.bookingId)!;
    expect(b.status).toBe("expired");
    expect(gateway.intents.get(b.paymentIntentId!)!.status).toBe("canceled");
    expect(store.nights.get("2026-11-24")).toEqual({ stops: 0, bags: 0 });
  });

  it("leaves a hold alone when the payment already went through", async () => {
    const { ctx, store, gateway, clock, resident } = setup();
    const res = await createBookingPayment(ctx, resident, bookingRequest());
    gateway.pay(store.bookings.get(res.bookingId)!.paymentIntentId!);
    clock.now = new Date(clock.now.getTime() + 31 * 60_000);
    expect(await expireHolds(ctx)).toEqual({ expired: 0, skipped: 1 });
    expect(store.bookings.get(res.bookingId)!.status).toBe("pending_payment");
  });
});
