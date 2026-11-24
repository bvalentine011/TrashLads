import type { AuditEntry, Booking, BookingStatus, Property, RefundRequest, UserRecord } from "./types";

/**
 * Persistence the services need. The Firestore adapter implements every method
 * that says "atomic" inside one transaction; the in-memory test store does the same.
 */
export interface Store {
  getUser(uid: string): Promise<UserRecord | null>;
  setRegistrationTerms(uid: string, version: string, acceptedAt: string): Promise<void>;
  /** Atomic: saves the id only if the user has none yet; returns the id that ended up stored. */
  setStripeCustomerIdIfMissing(uid: string, customerId: string): Promise<string>;

  getProperty(id: string): Promise<Property | null>;

  /**
   * Atomic: checks the night's stop and bag capacity and that this unit has no
   * other active booking that night, then writes the booking and the night totals.
   * Throws AppError("resource-exhausted") when full, ("already-exists") on a duplicate.
   */
  reserveBooking(booking: Booking, limits: { maxStops: number; maxBags: number }): Promise<void>;

  getBooking(id: string): Promise<Booking | null>;
  findBookingByPaymentIntent(paymentIntentId: string): Promise<Booking | null>;
  listBookingsForDate(serviceDate: string): Promise<Booking[]>;

  /**
   * Atomic: applies the patch only if the booking's status is one of `from`.
   * Releases the booking's capacity when it moves to a status that doesn't hold any.
   * Returns the updated booking, or null if the status didn't match (no change made).
   */
  transitionBooking(
    id: string,
    from: BookingStatus[],
    patch: Partial<Booking> & { status?: BookingStatus },
  ): Promise<Booking | null>;

  /** Atomic: adds to the refunded amount and recomputes refundState. Ignores a refund id it has already counted. */
  applyRefund(bookingId: string, stripeRefundId: string, amountCents: number): Promise<Booking | null>;

  findExpiredHolds(nowIso: string, limit: number): Promise<Booking[]>;

  createRefundRequest(r: RefundRequest): Promise<void>;
  getRefundRequest(id: string): Promise<RefundRequest | null>;
  /** Atomic: applies the patch only if the request's status is one of `from`. */
  transitionRefundRequest(
    id: string,
    from: RefundRequest["status"][],
    patch: Partial<RefundRequest>,
  ): Promise<RefundRequest | null>;
  openRefundRequestFor(bookingId: string): Promise<RefundRequest | null>;

  /**
   * Webhook idempotency. claim() atomically records the event id:
   * "new" means process it now; "done" means it was already processed;
   * "in-progress" means another delivery is handling it right now.
   */
  claimEvent(eventId: string, type: string, nowIso: string): Promise<"new" | "done" | "in-progress">;
  completeEvent(eventId: string, nowIso: string): Promise<void>;
  /** Lets Stripe's retry process the event again after a failure. */
  releaseEvent(eventId: string): Promise<void>;

  audit(entry: AuditEntry): Promise<void>;
}

export interface CreatePaymentIntentInput {
  amountCents: number;
  currency: string;
  customerId: string;
  /** Set only with the resident's explicit consent to save the card. */
  saveForFutureOnSession: boolean;
  /** Pay with a card the resident saved earlier. Must belong to `customerId`. */
  paymentMethodId?: string;
  description: string;
  metadata: Record<string, string>;
}

export interface GatewayPaymentIntent {
  id: string;
  clientSecret: string | null;
  status: string;
  amount: number;
  amountReceived: number;
  currency: string;
  customerId: string | null;
  livemode: boolean;
  metadata: Record<string, string>;
  paymentMethodId: string | null;
  latestChargeId: string | null;
}

export interface GatewayPaymentMethod {
  id: string;
  customerId: string | null;
  type: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  wallet?: string | null;
}

/** The Stripe calls the services make. The Stripe adapter implements it; tests use a fake. */
export interface PaymentGateway {
  readonly livemode: boolean;
  createCustomer(input: { uid: string; email?: string; name?: string }, idempotencyKey: string): Promise<string>;
  createCustomerSession(customerId: string): Promise<string>;
  createPaymentIntent(input: CreatePaymentIntentInput, idempotencyKey: string): Promise<GatewayPaymentIntent>;
  retrievePaymentIntent(id: string): Promise<GatewayPaymentIntent>;
  cancelPaymentIntent(id: string): Promise<void>;
  createRefund(
    input: { paymentIntentId: string; amountCents: number; metadata: Record<string, string> },
    idempotencyKey: string,
  ): Promise<{ id: string; status: string; amount: number }>;
  createSetupIntent(customerId: string, metadata: Record<string, string>, idempotencyKey: string): Promise<{ id: string; clientSecret: string }>;
  retrievePaymentMethod(id: string): Promise<GatewayPaymentMethod>;
  listCardPaymentMethods(customerId: string): Promise<GatewayPaymentMethod[]>;
  /** Marks a saved method so the Payment Element shows it at future checkouts. */
  allowRedisplay(paymentMethodId: string): Promise<void>;
  detachPaymentMethod(id: string): Promise<void>;
}
