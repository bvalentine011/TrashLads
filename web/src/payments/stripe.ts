import type { Appearance, Stripe } from "@stripe/stripe-js";
// The "pure" entry loads Stripe.js only when a payment form first needs it, not on every page.
import { loadStripe } from "@stripe/stripe-js/pure";

/**
 * VITE_STRIPE_PUBLISHABLE_KEY must be a pk_test_ key until go-live.
 * A pk_live_ key is refused unless VITE_LIVE_PAYMENTS_ENABLED is "true",
 * which should only be set alongside the server's go-live gates (see README).
 */
const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const liveAllowed = import.meta.env.VITE_LIVE_PAYMENTS_ENABLED === "true";

function checkedKey(): string {
  if (!key) throw new Error("VITE_STRIPE_PUBLISHABLE_KEY is not set.");
  if (key.startsWith("pk_test_")) return key;
  if (key.startsWith("pk_live_") && liveAllowed) return key;
  throw new Error("Live Stripe key refused: payments are in test mode until go-live is approved.");
}

let promise: Promise<Stripe | null> | null = null;
export const getStripe = () => (promise ??= loadStripe(checkedKey()));
export const isTestMode = () => !!key?.startsWith("pk_test_");

/** Matches the Trash Lads design: Overpass, forest green, hi-vis orange focus. */
export const appearance: Appearance = {
  theme: "stripe",
  variables: {
    fontFamily: "Overpass, ui-sans-serif, system-ui, sans-serif",
    colorPrimary: "#102A26",
    colorText: "#102A26",
    colorTextSecondary: "#3E6B4F",
    colorDanger: "#B42318",
    colorBackground: "#FFFFFF",
    borderRadius: "8px",
    focusBoxShadow: "0 0 0 3px #F47B20",
  },
  rules: {
    ".Input": { border: "1px solid rgba(62, 107, 79, 0.35)" },
    ".Tab--selected": { borderColor: "#102A26", boxShadow: "0 0 0 1px #102A26" },
  },
};

/** Cards only. Apple Pay and Google Pay are card wallets, so they're included. */
export const ALLOWED_TYPES = ["card"];
