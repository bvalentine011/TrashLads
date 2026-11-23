import Stripe from "stripe";
import type { CreatePaymentIntentInput, GatewayPaymentIntent, GatewayPaymentMethod, PaymentGateway } from "../domain/ports";

const idOf = (v: string | { id: string } | null | undefined): string | null => (v == null ? null : typeof v === "string" ? v : v.id);

function toIntent(pi: Stripe.PaymentIntent): GatewayPaymentIntent {
  return {
    id: pi.id,
    clientSecret: pi.client_secret,
    status: pi.status,
    amount: pi.amount,
    amountReceived: pi.amount_received,
    currency: pi.currency,
    customerId: idOf(pi.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null),
    livemode: pi.livemode,
    metadata: (pi.metadata ?? {}) as Record<string, string>,
    paymentMethodId: idOf(pi.payment_method as string | Stripe.PaymentMethod | null),
    latestChargeId: idOf(pi.latest_charge as string | Stripe.Charge | null),
  };
}

function toMethod(pm: Stripe.PaymentMethod): GatewayPaymentMethod {
  return {
    id: pm.id,
    customerId: idOf(pm.customer as string | Stripe.Customer | null),
    type: pm.type,
    brand: pm.card?.brand,
    last4: pm.card?.last4,
    expMonth: pm.card?.exp_month,
    expYear: pm.card?.exp_year,
    wallet: pm.card?.wallet?.type ?? null,
  };
}

export class StripeGateway implements PaymentGateway {
  constructor(private readonly stripe: Stripe, public readonly livemode: boolean) {}

  async createCustomer(input: { uid: string; email?: string; name?: string }, idempotencyKey: string): Promise<string> {
    const c = await this.stripe.customers.create(
      { email: input.email, name: input.name, metadata: { firebaseUid: input.uid } },
      { idempotencyKey },
    );
    return c.id;
  }

  async createCustomerSession(customerId: string): Promise<string> {
    const s = await this.stripe.customerSessions.create({
      customer: customerId,
      components: {
        payment_element: {
          enabled: true,
          features: {
            // Show cards the resident chose to save, and let them remove them.
            payment_method_redisplay: "enabled",
            payment_method_allow_redisplay_filters: ["always"],
            payment_method_remove: "enabled",
            // Saving is controlled by our own consent checkbox, not Stripe's.
            payment_method_save: "disabled",
          },
        },
      },
    });
    return s.client_secret;
  }

  async createPaymentIntent(input: CreatePaymentIntentInput, idempotencyKey: string): Promise<GatewayPaymentIntent> {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency,
        customer: input.customerId,
        // Cards only. Apple Pay and Google Pay are card wallets, so they're included
        // and the Payment Element shows them only on eligible browsers and devices.
        allowed_payment_method_types: ["card"],
        ...(input.saveForFutureOnSession ? { setup_future_usage: "on_session" as const } : {}),
        ...(input.paymentMethodId ? { payment_method: input.paymentMethodId } : {}),
        description: input.description,
        metadata: input.metadata,
      },
      { idempotencyKey },
    );
    return toIntent(pi);
  }

  async retrievePaymentIntent(id: string): Promise<GatewayPaymentIntent> {
    return toIntent(await this.stripe.paymentIntents.retrieve(id));
  }

  async cancelPaymentIntent(id: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(id, { cancellation_reason: "abandoned" });
  }

  async createRefund(
    input: { paymentIntentId: string; amountCents: number; metadata: Record<string, string> },
    idempotencyKey: string,
  ) {
    const r = await this.stripe.refunds.create(
      { payment_intent: input.paymentIntentId, amount: input.amountCents, reason: "requested_by_customer", metadata: input.metadata },
      { idempotencyKey },
    );
    return { id: r.id, status: r.status ?? "pending", amount: r.amount };
  }

  async createSetupIntent(customerId: string, metadata: Record<string, string>, idempotencyKey: string) {
    const si = await this.stripe.setupIntents.create(
      { customer: customerId, usage: "on_session", allowed_payment_method_types: ["card"], metadata },
      { idempotencyKey },
    );
    if (!si.client_secret) throw new Error("SetupIntent has no client secret");
    return { id: si.id, clientSecret: si.client_secret };
  }

  async retrievePaymentMethod(id: string): Promise<GatewayPaymentMethod> {
    return toMethod(await this.stripe.paymentMethods.retrieve(id));
  }

  async listCardPaymentMethods(customerId: string): Promise<GatewayPaymentMethod[]> {
    const list = await this.stripe.customers.listPaymentMethods(customerId, { type: "card", limit: 20 });
    return list.data.filter((pm) => pm.allow_redisplay === "always").map(toMethod);
  }

  async allowRedisplay(paymentMethodId: string): Promise<void> {
    await this.stripe.paymentMethods.update(paymentMethodId, { allow_redisplay: "always" });
  }

  async detachPaymentMethod(id: string): Promise<void> {
    await this.stripe.paymentMethods.detach(id);
  }
}
