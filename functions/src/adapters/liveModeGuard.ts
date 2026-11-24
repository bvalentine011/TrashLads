/**
 * Live payments stay off until every go-live step is done and recorded.
 * Set each variable to "true" only after doing that step (see README).
 */
export const GO_LIVE_GATES = [
  "GO_LIVE_STRIPE_ACCOUNT_APPROVED", // Stripe account activated and payouts enabled
  "GO_LIVE_PAYMENT_DOMAINS_REGISTERED", // Apple Pay / Google Pay domains registered for live mode
  "GO_LIVE_WEBHOOK_CONFIGURED", // live webhook endpoint + secret set, test event delivered
  "GO_LIVE_SECURITY_REVIEWED", // rules, functions and keys reviewed; test suite green
] as const;

export type Env = Record<string, string | undefined>;

export function missingGoLiveGates(env: Env): string[] {
  return GO_LIVE_GATES.filter((g) => env[g] !== "true");
}

/**
 * Throws unless the key is a test key, or every gate is set and LIVE_PAYMENTS_ENABLED is "true".
 * Returns whether the deployment is in live mode.
 */
export function assertKeyAllowed(secretKey: string | undefined, env: Env): boolean {
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set.");
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) return false;
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    const missing = missingGoLiveGates(env);
    if (env.ENFORCE_APP_CHECK === "false") {
      throw new Error("Live Stripe key refused: App Check must be enforced before taking real payments (remove ENFORCE_APP_CHECK=false).");
    }
    if (env.LIVE_PAYMENTS_ENABLED !== "true" || missing.length) {
      throw new Error(
        `Live Stripe key refused. Set LIVE_PAYMENTS_ENABLED=true and finish: ${missing.join(", ") || "(all gates set)"}`,
      );
    }
    return true;
  }
  throw new Error("STRIPE_SECRET_KEY doesn't look like a Stripe secret key.");
}
