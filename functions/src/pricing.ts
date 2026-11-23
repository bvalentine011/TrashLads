import { PRICING } from "./config";
import { AppError } from "./domain/errors";

export interface PriceBreakdown {
  currency: string;
  bagCount: number;
  baseFeeCents: number;
  perBagCents: number;
  bagSubtotalCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function isAllowedBagCount(n: unknown): n is 1 | 2 | 3 {
  return typeof n === "number" && (PRICING.allowedBagCounts as readonly number[]).includes(n);
}

/** $8 base + $3 per bag: 1 bag = $11, 2 = $14, 3 = $17, before any tax. */
export function priceFor(bagCount: number): PriceBreakdown {
  if (!isAllowedBagCount(bagCount)) {
    throw new AppError("invalid-argument", "Choose 1, 2 or 3 bags.");
  }
  const bagSubtotalCents = PRICING.perBagCents * bagCount;
  const subtotalCents = PRICING.baseFeeCents + bagSubtotalCents;
  const taxCents = Math.round((subtotalCents * PRICING.taxRateBasisPoints) / 10_000);
  return {
    currency: PRICING.currency,
    bagCount,
    baseFeeCents: PRICING.baseFeeCents,
    perBagCents: PRICING.perBagCents,
    bagSubtotalCents,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}
