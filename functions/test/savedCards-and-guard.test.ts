import { describe, expect, it } from "vitest";
import { TERMS } from "../src/config";
import { assertKeyAllowed, GO_LIVE_GATES } from "../src/adapters/liveModeGuard";
import { createSaveCardSetup, listSavedCards, preparePaymentElement, removeSavedCard } from "../src/services/savedMethods";
import { handleWebhookEvent } from "../src/services/webhook";
import { addUser, event, setup } from "./fakes";

describe("saved cards", () => {
  it("needs explicit consent before creating a SetupIntent", async () => {
    const { ctx, resident, store } = setup();
    await expect(createSaveCardSetup(ctx, resident, {})).rejects.toMatchObject({ reason: "save-card-consent-required" });
    const res = await createSaveCardSetup(ctx, resident, { consentVersion: TERMS.savedCardConsentVersion });
    expect(res.clientSecret).toMatch(/^seti_/);
    expect(store.actions()).toContain("save-card-consent");
  });

  it("lists only cards marked for redisplay, and only the caller's", async () => {
    const { ctx, gateway, store, resident } = setup();
    await preparePaymentElement(ctx, resident);
    const cus = store.users.get(resident.uid)!.stripeCustomerId!;
    gateway.methods.set("pm_a", { id: "pm_a", customerId: cus, type: "card", brand: "visa", last4: "4242", allowRedisplay: false });
    expect(await listSavedCards(ctx, resident)).toEqual([]);
    await handleWebhookEvent(ctx, event("setup_intent.succeeded", { id: "seti_1", payment_method: "pm_a" }));
    expect((await listSavedCards(ctx, resident)).map((c) => c.last4)).toEqual(["4242"]);

    const other = addUser(store, "u_other", true);
    await expect(removeSavedCard(ctx, other, { paymentMethodId: "pm_a" })).rejects.toMatchObject({ code: "not-found" });
    await removeSavedCard(ctx, resident, { paymentMethodId: "pm_a" });
    expect(await listSavedCards(ctx, resident)).toEqual([]);
  });

  it("gives the checkout a CustomerSession and the server price list", async () => {
    const { ctx, resident } = setup();
    const res = await preparePaymentElement(ctx, resident);
    expect(res.customerSessionClientSecret).toMatch(/^cuss_secret_cus_/);
    expect(res.prices.map((p) => p.totalCents)).toEqual([1100, 1400, 1700]);
    expect(res.savedCardConsent.version).toBe(TERMS.savedCardConsentVersion);
  });
});

describe("live-mode guard", () => {
  const allGates = Object.fromEntries(GO_LIVE_GATES.map((g) => [g, "true"]));

  it("runs on test keys", () => {
    expect(assertKeyAllowed("sk_test_123", {})).toBe(false);
    expect(assertKeyAllowed("rk_test_123", {})).toBe(false);
  });

  it("refuses a live key until every go-live gate and the switch are set", () => {
    expect(() => assertKeyAllowed("sk_live_123", {})).toThrow(/Live Stripe key refused/);
    expect(() => assertKeyAllowed("sk_live_123", { ...allGates })).toThrow(/LIVE_PAYMENTS_ENABLED/);
    const { GO_LIVE_WEBHOOK_CONFIGURED: _skip, ...oneMissing } = allGates;
    expect(() => assertKeyAllowed("sk_live_123", { ...oneMissing, LIVE_PAYMENTS_ENABLED: "true" })).toThrow(/GO_LIVE_WEBHOOK_CONFIGURED/);
    expect(assertKeyAllowed("sk_live_123", { ...allGates, LIVE_PAYMENTS_ENABLED: "true" })).toBe(true);
  });

  it("refuses missing or malformed keys", () => {
    expect(() => assertKeyAllowed(undefined, {})).toThrow(/not set/);
    expect(() => assertKeyAllowed("pk_test_123", {})).toThrow(/doesn't look like/);
  });
});
