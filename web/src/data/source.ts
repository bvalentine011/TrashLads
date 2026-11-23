import type {
  Booking, BookingDraft, BookingStatus, NightTotals, Property, RefundRequest, SessionUser, SupportCategory, SupportRequest, SupportStatus, Unsubscribe,
} from "./types";

export interface SignUpInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  /** Account terms version the person ticked at sign-up. */
  acceptedTermsVersion: string;
}

/**
 * Everything the screens need. FirebaseSource talks to Firebase Auth, Firestore
 * and Cloud Functions; DemoSource keeps sample data in memory so the app can be
 * clicked through with no backend.
 */
export interface DataSource {
  readonly mode: "live" | "demo";

  onSession(cb: (u: SessionUser | null) => void): Unsubscribe;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<void>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  acceptRegistrationTerms(version: string): Promise<void>;
  updateProfile(patch: { name?: string; phone?: string; defaults?: SessionUser["defaults"] }): Promise<void>;

  listProperties(): Promise<Property[]>;
  nightTotals(dates: string[]): Promise<Record<string, NightTotals>>;

  watchMyBookings(cb: (b: Booking[]) => void): Unsubscribe;
  watchBooking(id: string, cb: (b: Booking | null) => void): Unsubscribe;
  cancelBooking(id: string): Promise<{ canceled: boolean; reason?: string }>;
  requestRefund(bookingId: string, reason: string): Promise<void>;
  watchMyRefundRequests(cb: (r: RefundRequest[]) => void): Unsubscribe;

  createSupportRequest(input: { bookingId?: string; category: SupportCategory; message: string }): Promise<string>;
  watchMySupport(cb: (r: SupportRequest[]) => void): Unsubscribe;

  /** Demo mode only: books and "pays" without Stripe. */
  demoCheckout?(draft: BookingDraft, opts: { saveCard: boolean }): Promise<string>;

  // Owner
  watchNight(date: string, cb: (b: Booking[]) => void): Unsubscribe;
  ownerSetStatus(bookingId: string, status: BookingStatus, note?: string): Promise<void>;
  ownerStartNight(date: string): Promise<number>;
  watchRefundQueue(cb: (r: RefundRequest[]) => void): Unsubscribe;
  ownerReviewRefund(id: string, decision: "approve" | "deny", amountCents?: number, note?: string): Promise<void>;
  ownerRefund(bookingId: string, reason: string, amountCents?: number): Promise<void>;
  watchSupportQueue(cb: (r: SupportRequest[]) => void): Unsubscribe;
  ownerUpdateSupport(id: string, status: SupportStatus, note?: string): Promise<void>;
  getBooking(id: string): Promise<Booking | null>;
}
