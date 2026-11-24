import { getFunctions, httpsCallable, type FunctionsError } from "firebase/functions";
import { getApp } from "firebase/app";

/** Must match the Cloud Functions region in functions/src/index.ts. */
const functions = () => getFunctions(getApp(), "us-east1");
const call = <Req, Res>(name: string) => async (data: Req): Promise<Res> => (await httpsCallable<Req, Res>(functions(), name)(data)).data;

export interface Price {
  currency: string;
  bagCount: number;
  baseFeeCents: number;
  perBagCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export interface CheckoutSetup {
  customerSessionClientSecret: string;
  prices: Price[];
  serviceTermsVersion: string;
  savedCardConsent: { version: string; text: string };
}

export interface BookingDraft {
  propertyId: string;
  buildingLabel?: string;
  unitLabel: string;
  serviceDate: string; // yyyy-mm-dd
  bagCount: 1 | 2 | 3;
  instructions?: string;
  contact: { name: string; phone: string; email?: string };
  /** From the "Keep your community clean" checkbox on the Book screen. */
  acceptedPlacementPolicy: boolean;
}

export interface StartBookingPaymentRequest extends BookingDraft {
  clientRequestId: string;
  acceptedServiceTermsVersion: string;
  saveCardConsentVersion?: string;
}

export interface StartBookingPaymentResult {
  bookingId: string;
  clientSecret: string;
  price: Price;
  holdExpiresAt: string;
}

export interface SavedCard {
  id: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  wallet?: string | null;
}

export const api = {
  acceptTerms: call<{ version: string }, { version: string }>("acceptTerms"),
  getCheckoutSetup: call<Record<string, never>, CheckoutSetup>("getCheckoutSetup"),
  startBookingPayment: call<StartBookingPaymentRequest, StartBookingPaymentResult>("startBookingPayment"),
  cancelMyBooking: call<{ bookingId: string }, { canceled: boolean; refundRequestId?: string; reason?: string }>("cancelMyBooking"),
  requestRefund: call<{ bookingId: string; reason: string }, { refundRequestId: string }>("requestRefund"),
  startSaveCard: call<{ consentVersion: string }, { clientSecret: string }>("startSaveCard"),
  listMyCards: call<Record<string, never>, SavedCard[]>("listMyCards"),
  removeMyCard: call<{ paymentMethodId: string }, { removed: boolean }>("removeMyCard"),
  ownerReviewRefund: call<{ refundRequestId: string; decision: "approve" | "deny"; amountCents?: number; note?: string }, unknown>("ownerReviewRefund"),
  ownerIssueRefund: call<{ bookingId: string; amountCents?: number; reason: string }, unknown>("ownerIssueRefund"),
};

/** The machine-readable reason the server attached, e.g. "night-full" or "service-terms-required". */
export function errorReason(err: unknown): string | undefined {
  return ((err as FunctionsError)?.details as { reason?: string } | undefined)?.reason;
}

export function errorMessage(err: unknown): string {
  return (err as Error)?.message || "Something went wrong. Try again.";
}

export const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
