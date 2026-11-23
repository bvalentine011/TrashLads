/** Shapes shared by the Firebase and demo data sources. They mirror functions/src/domain/types.ts. */

export type BookingStatus =
  | "pending_payment"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "missed"
  | "canceled"
  | "payment_failed"
  | "expired";

export interface Price {
  currency: string;
  bagCount: number;
  baseFeeCents: number;
  perBagCents: number;
  bagSubtotalCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export interface Property {
  id: string;
  name: string;
  approved: boolean;
  enabled: boolean;
  /** Earliest time bags may go out, minutes after midnight. Defaults to 5 PM. */
  placementStartMinutes?: number;
  buildings?: { label: string; units?: string[] }[];
}

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
  price: Price;
  status: BookingStatus;
  paidAt?: string;
  completedAt?: string;
  ownerNote?: string;
  amountRefundedCents: number;
  refundState: "none" | "pending" | "partial" | "full";
  disputed?: boolean;
  createdAt: string;
}

export type RefundRequestStatus = "pending_review" | "approved" | "denied" | "refunded" | "failed";

export interface RefundRequest {
  id: string;
  bookingId: string;
  uid: string;
  origin: "customer_exception" | "customer_cancel" | "owner";
  reason: string;
  requestedCents: number;
  approvedCents?: number;
  status: RefundRequestStatus;
  reviewNote?: string;
  createdAt: string;
}

export type SupportCategory = "missed_pickup" | "billing" | "damage" | "account" | "other";
export type SupportStatus = "open" | "in_progress" | "resolved";

export interface SupportRequest {
  id: string;
  uid: string;
  bookingId?: string;
  category: SupportCategory;
  message: string;
  contactName: string;
  contactEmail: string;
  status: SupportStatus;
  ownerNote?: string;
  createdAt: string;
}

export interface SessionUser {
  uid: string;
  email: string;
  name: string;
  phone?: string;
  isOwner: boolean;
  /** Version of the account terms this user accepted, if any. */
  registrationTermsVersion?: string;
  defaults?: { propertyId?: string; buildingLabel?: string; unitLabel?: string; instructions?: string };
}

export interface BookingDraft {
  propertyId: string;
  buildingLabel?: string;
  unitLabel: string;
  serviceDate: string;
  bagCount: 1 | 2 | 3;
  instructions?: string;
  contact: { name: string; phone: string; email?: string };
  acceptedPlacementPolicy: boolean;
}

export interface NightTotals {
  stops: number;
  bags: number;
}

export type Unsubscribe = () => void;
