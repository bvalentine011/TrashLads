import type { PriceBreakdown } from "../pricing";

export interface TermsAcceptance {
  version: string;
  acceptedAt: string; // ISO timestamp set by the server
}

export interface UserRecord {
  uid: string;
  email?: string;
  name?: string;
  stripeCustomerId?: string;
  registrationTerms?: TermsAcceptance;
}

export interface Property {
  id: string;
  name: string;
  /** Approved by Trash Lad for service. */
  approved: boolean;
  /** Taking new bookings right now. */
  enabled: boolean;
  /** Known buildings and units. Unknown ones are accepted but flagged for the owner. */
  buildings?: { label: string; units?: string[] }[];
}

/**
 * pending_payment: capacity held, waiting for Stripe.
 * confirmed: payment verified by webhook. The only state that puts a stop on the route.
 * payment_failed / expired: hold released, nothing charged.
 */
export type BookingStatus =
  | "pending_payment"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "missed"
  | "canceled"
  | "payment_failed"
  | "expired";

/** Statuses that occupy capacity on a night. */
export const ACTIVE_STATUSES: BookingStatus[] = ["pending_payment", "confirmed", "in_progress", "completed"];

export interface Booking {
  id: string;
  uid: string;
  propertyId: string;
  buildingLabel: string;
  unitLabel: string;
  locationUnverified: boolean;
  serviceDate: string;
  bagCount: number;
  instructions?: string;
  contact: { name: string; phone: string; email?: string };
  price: PriceBreakdown;
  status: BookingStatus;
  serviceTerms: TermsAcceptance;
  placementPolicyAcceptedAt: string;
  saveCardConsent?: TermsAcceptance;
  stripeCustomerId: string;
  paymentIntentId?: string;
  paidAt?: string;
  holdExpiresAt: string;
  amountRefundedCents: number;
  refundState: "none" | "pending" | "partial" | "full";
  disputed?: boolean;
  completedAt?: string;
  /** Owner's note, e.g. why a pickup was missed. */
  ownerNote?: string;
  createdAt: string;
  updatedAt: string;
}

export type RefundRequestStatus = "pending_review" | "approved" | "denied" | "refunded" | "failed";

export interface RefundRequest {
  id: string;
  bookingId: string;
  uid: string;
  /** Who started it: a resident asking after the cutoff, or the owner on their own. */
  origin: "customer_exception" | "customer_cancel" | "owner";
  reason: string;
  requestedCents: number;
  approvedCents?: number;
  status: RefundRequestStatus;
  reviewedBy?: string;
  reviewNote?: string;
  stripeRefundId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  at: string;
  actor: string; // uid, "stripe" or "system"
  action: string;
  bookingId?: string;
  refundRequestId?: string;
  detail?: Record<string, unknown>;
}
