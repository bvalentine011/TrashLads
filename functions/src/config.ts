/**
 * Business rules for Trash Lad payments. Every value the server trusts lives
 * here, so the client can never supply its own price, capacity or terms.
 */
export const PRICING = {
  currency: "usd",
  baseFeeCents: 800,
  perBagCents: 300,
  allowedBagCounts: [1, 2, 3] as const,
  /**
   * Sales tax is not calculated yet. Set this only after deciding, with an
   * accountant, whether trash valet service is taxable where you operate.
   * Stripe Tax is the recommended way to add it (see README).
   */
  taxRateBasisPoints: 0,
} as const;

export const CAPACITY = {
  maxStopsPerNight: 25,
  maxBagsPerNight: 60,
} as const;

export const SCHEDULE = {
  timeZone: "America/New_York",
  /** Pickup window shown to residents. Minutes after midnight, Eastern. */
  windowStartMinutes: 18 * 60,
  windowEndMinutes: 23 * 60,
  /** Same-day bookings close at 8 PM Eastern. */
  sameDayCutoffMinutes: 20 * 60,
  /** Residents can cancel for a full refund until 5 PM Eastern on the pickup date. */
  customerCancelCutoffMinutes: 17 * 60,
  /** How far ahead residents can book. */
  bookingHorizonDays: 21,
  /** Weeknights only: Monday (1) to Friday (5). */
  serviceWeekdays: [1, 2, 3, 4, 5] as const,
  /** Nights with no service. Keep this list in sync with the booking calendar. */
  closedDates: ["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25", "2027-01-01"] as const,
} as const;

export const TERMS = {
  /** Bump a version whenever the text changes; users must accept the new version. */
  registrationTermsVersion: "2026-11-01",
  serviceTermsVersion: "2026-11-01",
  savedCardConsentVersion: "2026-11-01",
  savedCardConsentText:
    "Save this card to my Trash Lad account so I can use it for future bookings. " +
    "I can remove it at any time from my account. Trash Lad will only charge it when I book.",
} as const;

export const PAYMENTS = {
  /** Unpaid bookings hold capacity for this long before they are released. */
  holdMinutes: 30,
} as const;

export const ROLES = {
  /** Firebase Auth custom claim that marks an owner account. */
  ownerClaim: "owner",
} as const;
