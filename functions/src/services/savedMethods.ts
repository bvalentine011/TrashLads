import { TERMS } from "../config";
import { AppError } from "../domain/errors";
import type { GatewayPaymentMethod } from "../domain/ports";
import { priceFor } from "../pricing";
import type { Caller, Ctx } from "./context";
import { ensureStripeCustomer } from "./customers";
import { requireCurrentRegistrationTerms } from "./terms";

/**
 * Everything the checkout page needs before it shows the Payment Element:
 * a CustomerSession (so saved cards can be shown) and the server's price list.
 */
export async function preparePaymentElement(ctx: Ctx, caller: Caller) {
  await requireCurrentRegistrationTerms(ctx, caller.uid);
  const customerId = await ensureStripeCustomer(ctx, caller);
  const customerSessionClientSecret = await ctx.gateway.createCustomerSession(customerId);
  return {
    customerSessionClientSecret,
    prices: [1, 2, 3].map((n) => priceFor(n)),
    serviceTermsVersion: TERMS.serviceTermsVersion,
    savedCardConsent: { version: TERMS.savedCardConsentVersion, text: TERMS.savedCardConsentText },
  };
}

/** Save a card from the account page, outside a booking. Needs explicit consent. */
export async function createSaveCardSetup(ctx: Ctx, caller: Caller, input: { consentVersion?: unknown }) {
  if (input.consentVersion !== TERMS.savedCardConsentVersion) {
    throw new AppError("failed-precondition", "Agree to save the card to continue.", "save-card-consent-required");
  }
  await requireCurrentRegistrationTerms(ctx, caller.uid);
  const customerId = await ensureStripeCustomer(ctx, caller);
  const nowIso = ctx.now().toISOString();
  const setup = await ctx.gateway.createSetupIntent(
    customerId,
    { uid: caller.uid, consentVersion: TERMS.savedCardConsentVersion, consentAt: nowIso },
    `setup-${caller.uid}-${nowIso.slice(0, 16)}`,
  );
  await ctx.store.audit({ at: nowIso, actor: caller.uid, action: "save-card-consent", detail: { version: TERMS.savedCardConsentVersion, setupIntentId: setup.id } });
  return { clientSecret: setup.clientSecret };
}

export interface SavedCardView {
  id: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  wallet?: string | null;
}

export async function listSavedCards(ctx: Ctx, caller: Caller): Promise<SavedCardView[]> {
  const user = await ctx.store.getUser(caller.uid);
  if (!user?.stripeCustomerId) return [];
  const methods = await ctx.gateway.listCardPaymentMethods(user.stripeCustomerId);
  return methods.map(({ id, brand, last4, expMonth, expYear, wallet }: GatewayPaymentMethod) => ({ id, brand, last4, expMonth, expYear, wallet }));
}

export async function removeSavedCard(ctx: Ctx, caller: Caller, input: { paymentMethodId?: unknown }) {
  if (typeof input.paymentMethodId !== "string") throw new AppError("invalid-argument", "Missing card.");
  const user = await ctx.store.getUser(caller.uid);
  const pm = await ctx.gateway.retrievePaymentMethod(input.paymentMethodId);
  if (!user?.stripeCustomerId || pm.customerId !== user.stripeCustomerId) {
    throw new AppError("not-found", "Card not found.");
  }
  await ctx.gateway.detachPaymentMethod(pm.id);
  await ctx.store.audit({ at: ctx.now().toISOString(), actor: caller.uid, action: "saved-card-removed", detail: { paymentMethodId: pm.id } });
  return { removed: true };
}
