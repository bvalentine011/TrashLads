import type { CreatePaymentIntentInput, GatewayPaymentIntent, GatewayPaymentMethod, PaymentGateway, Store } from "../src/domain/ports";
import { ACTIVE_STATUSES, type AuditEntry, type Booking, type BookingStatus, type Property, type RefundRequest, type UserRecord } from "../src/domain/types";
import { AppError } from "../src/domain/errors";
import type { Caller, Ctx } from "../src/services/context";
import { TERMS } from "../src/config";

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Same contract as FirestoreStore. JS is single-threaded, so each method is atomic. */
export class MemoryStore implements Store {
  users = new Map<string, UserRecord>();
  properties = new Map<string, Property>();
  bookings = new Map<string, Booking>();
  nights = new Map<string, { stops: number; bags: number }>();
  unitNights = new Map<string, string>();
  refunds = new Map<string, RefundRequest>();
  refundLedger = new Set<string>();
  events = new Map<string, { status: "processing" | "done"; claimedAt: string }>();
  auditLog: AuditEntry[] = [];

  private unitKey(b: Booking) {
    return `${b.serviceDate}|${b.propertyId}|${(b.buildingLabel || "-").toUpperCase()}|${b.unitLabel.toUpperCase()}`;
  }

  async getUser(uid: string) { return clone(this.users.get(uid) ?? null); }
  async setRegistrationTerms(uid: string, version: string, acceptedAt: string) {
    const u = this.users.get(uid)!;
    u.registrationTerms = { version, acceptedAt };
  }
  async setStripeCustomerIdIfMissing(uid: string, id: string) {
    const u = this.users.get(uid)!;
    if (!u.stripeCustomerId) u.stripeCustomerId = id;
    return u.stripeCustomerId;
  }
  async getProperty(id: string) { return clone(this.properties.get(id) ?? null); }

  async reserveBooking(b: Booking, limits: { maxStops: number; maxBags: number }) {
    if (this.bookings.has(b.id)) throw new AppError("already-exists", "exists");
    if (this.unitNights.has(this.unitKey(b))) throw new AppError("already-exists", "unit", "unit-already-booked");
    const n = this.nights.get(b.serviceDate) ?? { stops: 0, bags: 0 };
    if (n.stops + 1 > limits.maxStops || n.bags + b.bagCount > limits.maxBags) {
      throw new AppError("resource-exhausted", "full", "night-full");
    }
    this.nights.set(b.serviceDate, { stops: n.stops + 1, bags: n.bags + b.bagCount });
    this.unitNights.set(this.unitKey(b), b.id);
    this.bookings.set(b.id, clone(b));
  }

  async getBooking(id: string) { return clone(this.bookings.get(id) ?? null); }
  async findBookingByPaymentIntent(pi: string) {
    return clone([...this.bookings.values()].find((b) => b.paymentIntentId === pi) ?? null);
  }

  async listBookingsForDate(d: string) { return clone([...this.bookings.values()].filter((b) => b.serviceDate === d)); }

  async transitionBooking(id: string, from: BookingStatus[], patch: Partial<Booking>) {
    const cur = this.bookings.get(id);
    if (!cur || !from.includes(cur.status)) return null;
    const next = { ...cur, ...clone(patch) } as Booking;
    if (ACTIVE_STATUSES.includes(cur.status) && !ACTIVE_STATUSES.includes(next.status)) {
      const n = this.nights.get(cur.serviceDate)!;
      this.nights.set(cur.serviceDate, { stops: n.stops - 1, bags: n.bags - cur.bagCount });
      if (this.unitNights.get(this.unitKey(cur)) === cur.id) this.unitNights.delete(this.unitKey(cur));
    }
    this.bookings.set(id, next);
    return clone(next);
  }

  async applyRefund(bookingId: string, refundId: string, amount: number) {
    const b = this.bookings.get(bookingId);
    if (!b) return null;
    if (this.refundLedger.has(refundId)) return clone(b);
    this.refundLedger.add(refundId);
    b.amountRefundedCents = Math.min(b.price.totalCents, b.amountRefundedCents + amount);
    b.refundState = b.amountRefundedCents >= b.price.totalCents ? "full" : "partial";
    return clone(b);
  }

  async findExpiredHolds(nowIso: string, limit: number) {
    return clone([...this.bookings.values()].filter((b) => b.status === "pending_payment" && b.holdExpiresAt < nowIso).slice(0, limit));
  }

  async createRefundRequest(r: RefundRequest) {
    if (this.refunds.has(r.id)) throw new AppError("already-exists", "exists");
    this.refunds.set(r.id, clone(r));
  }
  async getRefundRequest(id: string) { return clone(this.refunds.get(id) ?? null); }
  async transitionRefundRequest(id: string, from: RefundRequest["status"][], patch: Partial<RefundRequest>) {
    const cur = this.refunds.get(id);
    if (!cur || !from.includes(cur.status)) return null;
    const next = { ...cur, ...clone(patch) };
    this.refunds.set(id, next);
    return clone(next);
  }
  async openRefundRequestFor(bookingId: string) {
    return clone([...this.refunds.values()].find((r) => r.bookingId === bookingId && (r.status === "pending_review" || r.status === "approved")) ?? null);
  }

  async claimEvent(id: string, _type: string, nowIso: string) {
    const e = this.events.get(id);
    if (e?.status === "done") return "done" as const;
    if (e?.status === "processing") return "in-progress" as const;
    this.events.set(id, { status: "processing", claimedAt: nowIso });
    return "new" as const;
  }
  async completeEvent(id: string) { this.events.get(id)!.status = "done"; }
  async releaseEvent(id: string) { this.events.delete(id); }
  async audit(e: AuditEntry) { this.auditLog.push(clone(e)); }

  actions() { return this.auditLog.map((a) => a.action); }
}

interface FakeIntent extends GatewayPaymentIntent { setupFutureUsage: boolean; createParams: CreatePaymentIntentInput }

/** Stripe stand-in. Honors idempotency keys and refuses over-refunds, like Stripe does. */
export class FakeGateway implements PaymentGateway {
  livemode = false;
  intents = new Map<string, FakeIntent>();
  refunds: { id: string; paymentIntentId: string; amount: number; metadata: Record<string, string> }[] = [];
  methods = new Map<string, GatewayPaymentMethod & { allowRedisplay: boolean }>();
  customers: string[] = [];
  private idem = new Map<string, unknown>();
  private seq = 0;
  failNextPaymentIntent = false;

  private once<T>(key: string, make: () => T): T {
    if (!this.idem.has(key)) this.idem.set(key, make());
    return this.idem.get(key) as T;
  }

  async createCustomer(_i: { uid: string }, key: string) {
    return this.once(key, () => {
      const id = `cus_${++this.seq}`;
      this.customers.push(id);
      return id;
    });
  }
  async createCustomerSession(customerId: string) { return `cuss_secret_${customerId}`; }

  async createPaymentIntent(input: CreatePaymentIntentInput, key: string) {
    if (this.failNextPaymentIntent) {
      this.failNextPaymentIntent = false;
      throw new Error("Stripe unavailable");
    }
    const pi = this.once(key, () => {
      const id = `pi_${++this.seq}`;
      const intent: FakeIntent = {
        id, clientSecret: `${id}_secret`, status: "requires_payment_method", amount: input.amountCents, amountReceived: 0,
        currency: input.currency, customerId: input.customerId, livemode: false, metadata: input.metadata,
        paymentMethodId: null, latestChargeId: null, setupFutureUsage: input.saveForFutureOnSession, createParams: input,
      };
      this.intents.set(id, intent);
      return intent;
    });
    return clone(pi);
  }
  async retrievePaymentIntent(id: string) {
    const pi = this.intents.get(id);
    if (!pi) throw new Error(`No such payment_intent: ${id}`);
    return clone(pi);
  }
  async cancelPaymentIntent(id: string) {
    const pi = this.intents.get(id)!;
    if (pi.status === "succeeded") throw new Error("You cannot cancel a succeeded PaymentIntent");
    pi.status = "canceled";
  }
  /** Test helper: what Stripe does when the resident pays. */
  pay(id: string, opts: { amount?: number; pm?: string } = {}) {
    const pi = this.intents.get(id)!;
    pi.status = "succeeded";
    pi.amountReceived = opts.amount ?? pi.amount;
    pi.paymentMethodId = opts.pm ?? `pm_${++this.seq}`;
    if (!this.methods.has(pi.paymentMethodId)) {
      this.methods.set(pi.paymentMethodId, { id: pi.paymentMethodId, customerId: pi.customerId, type: "card", brand: "visa", last4: "4242", allowRedisplay: false });
    }
    return pi;
  }
  async createRefund(input: { paymentIntentId: string; amountCents: number; metadata: Record<string, string> }, key: string) {
    return this.once(key, () => {
      const pi = this.intents.get(input.paymentIntentId)!;
      const already = this.refunds.filter((r) => r.paymentIntentId === pi.id).reduce((s, r) => s + r.amount, 0);
      if (already + input.amountCents > pi.amountReceived) throw new Error("Refund exceeds charge");
      const r = { id: `re_${++this.seq}`, paymentIntentId: pi.id, amount: input.amountCents, metadata: input.metadata };
      this.refunds.push(r);
      return { id: r.id, status: "pending", amount: r.amount };
    });
  }
  async createSetupIntent(_c: string, _m: Record<string, string>, key: string) {
    return this.once(key, () => ({ id: `seti_${++this.seq}`, clientSecret: `seti_${this.seq}_secret` }));
  }
  async retrievePaymentMethod(id: string) {
    const m = this.methods.get(id);
    if (!m) throw new Error("No such payment method");
    return clone(m);
  }
  async listCardPaymentMethods(customerId: string) {
    return [...this.methods.values()].filter((m) => m.customerId === customerId && m.allowRedisplay).map(clone);
  }
  async allowRedisplay(id: string) {
    const m = this.methods.get(id);
    if (m) m.allowRedisplay = true;
  }
  async detachPaymentMethod(id: string) {
    const m = this.methods.get(id)!;
    m.customerId = null;
  }
}

export const MONDAY_NOON_ET = new Date("2026-11-23T17:00:00Z"); // Mon Nov 23, 12:00 PM Eastern

export function setup(now = MONDAY_NOON_ET) {
  const store = new MemoryStore();
  const gateway = new FakeGateway();
  const clock = { now };
  const ctx: Ctx = { store, gateway, now: () => clock.now };
  store.properties.set("sample-commons", {
    id: "sample-commons", name: "Sample Commons", approved: true, enabled: true,
    buildings: [{ label: "Building B", units: ["203", "204", "207"] }],
  });
  store.properties.set("placeholder-pointe", { id: "placeholder-pointe", name: "Placeholder Pointe", approved: false, enabled: false });
  const resident = addUser(store, "u_resident", true);
  const owner: Caller = { uid: "u_owner", isOwner: true };
  store.users.set("u_owner", { uid: "u_owner", registrationTerms: { version: TERMS.registrationTermsVersion, acceptedAt: now.toISOString() } });
  return { store, gateway, ctx, clock, resident, owner };
}

export function addUser(store: MemoryStore, uid: string, acceptedTerms: boolean): Caller {
  store.users.set(uid, {
    uid, email: `${uid}@example.com`, name: "Test Resident",
    registrationTerms: acceptedTerms ? { version: TERMS.registrationTermsVersion, acceptedAt: "2026-11-01T00:00:00Z" } : undefined,
  });
  return { uid, email: `${uid}@example.com`, isOwner: false };
}

let reqSeq = 0;
export function bookingRequest(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: `req_test_${++reqSeq}_abcdef`,
    propertyId: "sample-commons",
    buildingLabel: "Building B",
    unitLabel: "207",
    serviceDate: "2026-11-24",
    bagCount: 2,
    contact: { name: "Test Resident", phone: "(555) 010-0100", email: "t@example.com" },
    acceptedServiceTermsVersion: TERMS.serviceTermsVersion,
    acceptedPlacementPolicy: true,
    ...overrides,
  };
}

export function event(type: string, object: Record<string, any>, id = `evt_${Math.random().toString(36).slice(2)}`) {
  return { id, type, livemode: false, object };
}
