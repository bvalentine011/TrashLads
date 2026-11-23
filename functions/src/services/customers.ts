import { AppError } from "../domain/errors";
import type { Caller, Ctx } from "./context";

/**
 * Returns the caller's Stripe Customer id, creating the Customer once.
 * The Stripe idempotency key and the store's create-if-missing write together
 * make sure two simultaneous requests can't create two Customers.
 */
export async function ensureStripeCustomer(ctx: Ctx, caller: Caller): Promise<string> {
  const user = await ctx.store.getUser(caller.uid);
  if (!user) throw new AppError("failed-precondition", "Finish creating your account first.", "account-required");
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const created = await ctx.gateway.createCustomer(
    { uid: caller.uid, email: user.email ?? caller.email, name: user.name ?? caller.name },
    `customer-${caller.uid}`,
  );
  return ctx.store.setStripeCustomerIdIfMissing(caller.uid, created);
}
