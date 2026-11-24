import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../domain/errors";
import type { Store } from "../domain/ports";
import { ACTIVE_STATUSES, type AuditEntry, type Booking, type BookingStatus, type Property, type RefundRequest, type UserRecord } from "../domain/types";

/**
 * Collections
 *   users/{uid}                     profile, stripeCustomerId, registrationTerms (server-written only)
 *   properties/{id}                 approved communities
 *   bookings/{id}                   one per checkout
 *   nights/{yyyy-mm-dd}             { stops, bags } totals that enforce capacity
 *   unitNights/{date__prop__unit}   one active booking per unit per night
 *   refundRequests/{id}
 *   webhookEvents/{stripeEventId}   idempotency ledger
 *   auditLog/{auto}
 */
const STALE_CLAIM_MS = 5 * 60_000;

function unitKey(b: Pick<Booking, "serviceDate" | "propertyId" | "buildingLabel" | "unitLabel">): string {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, "_");
  return `${b.serviceDate}__${b.propertyId}__${clean(b.buildingLabel || "-")}__${clean(b.unitLabel)}`;
}

const holdsCapacity = (s: BookingStatus) => ACTIVE_STATUSES.includes(s);

export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  private users = () => this.db.collection("users");
  private bookings = () => this.db.collection("bookings");
  private nights = () => this.db.collection("nights");
  private unitNights = () => this.db.collection("unitNights");
  private refunds = () => this.db.collection("refundRequests");
  private events = () => this.db.collection("webhookEvents");

  async getUser(uid: string): Promise<UserRecord | null> {
    const s = await this.users().doc(uid).get();
    return s.exists ? ({ uid, ...s.data() } as UserRecord) : null;
  }

  async setRegistrationTerms(uid: string, version: string, acceptedAt: string): Promise<void> {
    await this.users().doc(uid).set({ registrationTerms: { version, acceptedAt } }, { merge: true });
  }

  async setStripeCustomerIdIfMissing(uid: string, customerId: string): Promise<string> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.users().doc(uid);
      const snap = await tx.get(ref);
      const existing = snap.get("stripeCustomerId") as string | undefined;
      if (existing) return existing;
      tx.set(ref, { stripeCustomerId: customerId }, { merge: true });
      return customerId;
    });
  }

  async getProperty(id: string): Promise<Property | null> {
    const s = await this.db.collection("properties").doc(id).get();
    return s.exists ? ({ id, ...s.data() } as Property) : null;
  }

  async reserveBooking(booking: Booking, limits: { maxStops: number; maxBags: number }): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const nightRef = this.nights().doc(booking.serviceDate);
      const unitRef = this.unitNights().doc(unitKey(booking));
      const bookingRef = this.bookings().doc(booking.id);
      const [night, unit, existing] = await Promise.all([tx.get(nightRef), tx.get(unitRef), tx.get(bookingRef)]);
      if (existing.exists) throw new AppError("already-exists", "This checkout already exists.");
      if (unit.exists) {
        throw new AppError("already-exists", "This unit already has a pickup that night.", "unit-already-booked");
      }
      const stops = (night.get("stops") as number | undefined) ?? 0;
      const bags = (night.get("bags") as number | undefined) ?? 0;
      if (stops + 1 > limits.maxStops || bags + booking.bagCount > limits.maxBags) {
        throw new AppError("resource-exhausted", "That night is full. Choose another night.", "night-full");
      }
      tx.set(nightRef, { stops: stops + 1, bags: bags + booking.bagCount, updatedAt: booking.createdAt }, { merge: true });
      tx.set(unitRef, { bookingId: booking.id, uid: booking.uid });
      tx.set(bookingRef, booking);
    });
  }

  async getBooking(id: string): Promise<Booking | null> {
    const s = await this.bookings().doc(id).get();
    return s.exists ? (s.data() as Booking) : null;
  }

  async findBookingByPaymentIntent(paymentIntentId: string): Promise<Booking | null> {
    const q = await this.bookings().where("paymentIntentId", "==", paymentIntentId).limit(1).get();
    return q.empty ? null : (q.docs[0].data() as Booking);
  }

  async listBookingsForDate(serviceDate: string): Promise<Booking[]> {
    const q = await this.bookings().where("serviceDate", "==", serviceDate).get();
    return q.docs.map((d) => d.data() as Booking);
  }

  private release(tx: Transaction, b: Booking, unitSnapBookingId: string | undefined, nightStops: number, nightBags: number): void {
    tx.set(this.nights().doc(b.serviceDate), { stops: Math.max(0, nightStops - 1), bags: Math.max(0, nightBags - b.bagCount) }, { merge: true });
    if (unitSnapBookingId === b.id) tx.delete(this.unitNights().doc(unitKey(b)));
  }

  async transitionBooking(id: string, from: BookingStatus[], patch: Partial<Booking>): Promise<Booking | null> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.bookings().doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const current = snap.data() as Booking;
      if (!from.includes(current.status)) return null;
      const next = { ...current, ...patch } as Booking;
      if (holdsCapacity(current.status) && !holdsCapacity(next.status)) {
        const [night, unit] = await Promise.all([tx.get(this.nights().doc(current.serviceDate)), tx.get(this.unitNights().doc(unitKey(current)))]);
        this.release(tx, current, unit.get("bookingId"), night.get("stops") ?? 0, night.get("bags") ?? 0);
      }
      tx.set(ref, next);
      return next;
    });
  }

  async applyRefund(bookingId: string, stripeRefundId: string, amountCents: number): Promise<Booking | null> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.bookings().doc(bookingId);
      const ledger = ref.collection("refunds").doc(stripeRefundId);
      const [snap, seen] = await Promise.all([tx.get(ref), tx.get(ledger)]);
      if (!snap.exists) return null;
      const b = snap.data() as Booking;
      if (seen.exists) return b;
      const refunded = Math.min(b.price.totalCents, b.amountRefundedCents + amountCents);
      const next: Booking = { ...b, amountRefundedCents: refunded, refundState: refunded >= b.price.totalCents ? "full" : "partial" };
      tx.set(ledger, { amountCents });
      tx.set(ref, next);
      return next;
    });
  }

  async findExpiredHolds(nowIso: string, limit: number): Promise<Booking[]> {
    const q = await this.bookings().where("status", "==", "pending_payment").where("holdExpiresAt", "<", nowIso).limit(limit).get();
    return q.docs.map((d) => d.data() as Booking);
  }

  async createRefundRequest(r: RefundRequest): Promise<void> {
    await this.refunds().doc(r.id).create(r);
  }

  async getRefundRequest(id: string): Promise<RefundRequest | null> {
    const s = await this.refunds().doc(id).get();
    return s.exists ? (s.data() as RefundRequest) : null;
  }

  async transitionRefundRequest(id: string, from: RefundRequest["status"][], patch: Partial<RefundRequest>): Promise<RefundRequest | null> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.refunds().doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const current = snap.data() as RefundRequest;
      if (!from.includes(current.status)) return null;
      const next = { ...current, ...patch };
      tx.set(ref, next);
      return next;
    });
  }

  async openRefundRequestFor(bookingId: string): Promise<RefundRequest | null> {
    const q = await this.refunds().where("bookingId", "==", bookingId).where("status", "in", ["pending_review", "approved"]).limit(1).get();
    return q.empty ? null : (q.docs[0].data() as RefundRequest);
  }

  async claimEvent(eventId: string, type: string, nowIso: string): Promise<"new" | "done" | "in-progress"> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.events().doc(eventId);
      const snap = await tx.get(ref);
      if (snap.exists) {
        if (snap.get("status") === "done") return "done";
        const claimedAt = Date.parse(snap.get("claimedAt") as string);
        if (Date.now() - claimedAt < STALE_CLAIM_MS) return "in-progress";
      }
      tx.set(ref, { type, status: "processing", claimedAt: nowIso });
      return "new";
    });
  }

  async completeEvent(eventId: string, nowIso: string): Promise<void> {
    await this.events().doc(eventId).set({ status: "done", completedAt: nowIso }, { merge: true });
  }

  async releaseEvent(eventId: string): Promise<void> {
    await this.events().doc(eventId).delete();
  }

  async audit(entry: AuditEntry): Promise<void> {
    await this.db.collection("auditLog").add({ ...entry, serverTime: FieldValue.serverTimestamp() });
  }
}
