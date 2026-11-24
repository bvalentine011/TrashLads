import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorMessage, errorReason, money, type BookingDraft, type CheckoutSetup } from "./api";
import { ALLOWED_TYPES, appearance, getStripe, isTestMode } from "./stripe";
import { useBookingStatus } from "./useBookingStatus";
import { RegistrationTermsPrompt } from "./RegistrationTerms";

interface Props {
  draft: BookingDraft;
  /** Opens the full pickup service terms (a page or dialog in your app). */
  serviceTermsHref: string;
  onConfirmed: (bookingId: string) => void;
  /** Sends the resident back to the Book screen, e.g. when the night filled up. */
  onBackToBooking: (message: string) => void;
}

/**
 * The payment part of the Review & pay step.
 *
 * Uses the Payment Element's deferred-intent flow: the card form (and Apple Pay
 * or Google Pay, shown only on browsers and devices that support them) appears
 * immediately, and the server creates the PaymentIntent when the resident
 * presses Pay, after it has re-checked terms, property, capacity and price.
 */
export function CheckoutPayment(props: Props) {
  const [setup, setSetup] = useState<CheckoutSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [needsRegistrationTerms, setNeedsRegistrationTerms] = useState(false);
  const [saveCard, setSaveCard] = useState(false);

  const load = () => {
    setSetupError(null);
    api.getCheckoutSetup({})
      .then((s) => { setSetup(s); setNeedsRegistrationTerms(false); })
      .catch((err) => {
        if (errorReason(err) === "registration-terms-required") setNeedsRegistrationTerms(true);
        else setSetupError(errorMessage(err));
      });
  };
  useEffect(load, []);

  const price = setup?.prices.find((p) => p.bagCount === props.draft.bagCount);
  const options = useMemo(
    () =>
      price && setup
        ? {
            mode: "payment" as const,
            amount: price.totalCents,
            currency: price.currency,
            allowedPaymentMethodTypes: ALLOWED_TYPES,
            setupFutureUsage: saveCard ? ("on_session" as const) : null,
            customerSessionClientSecret: setup.customerSessionClientSecret,
            appearance,
          }
        : null,
    // Elements reads setupFutureUsage from `options`; react-stripe-js applies changes with elements.update().
    [price, setup, saveCard],
  );

  if (needsRegistrationTerms) return <RegistrationTermsPrompt onAccepted={load} />;
  if (setupError) return <p role="alert" className="tl-pay-error">{setupError} <button onClick={load}>Try again</button></p>;
  if (!setup || !price || !options) return <p className="tl-pay-muted">Loading payment options…</p>;

  return (
    <Elements stripe={getStripe()} options={options}>
      <PaymentForm {...props} setup={setup} totalCents={price.totalCents} saveCard={saveCard} setSaveCard={setSaveCard} />
    </Elements>
  );
}

function PaymentForm({
  draft, serviceTermsHref, onConfirmed, onBackToBooking, setup, totalCents, saveCard, setSaveCard,
}: Props & { setup: CheckoutSetup; totalCents: number; saveCard: boolean; setSaveCard: (v: boolean) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [serviceTermsAccepted, setServiceTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  // One id per checkout attempt, so a double click or a network retry can't book twice.
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());
  // Once the server has created the payment, its save-card setting is fixed, so the box locks.
  const [started, setStarted] = useState(false);
  const { status, timedOut } = useBookingStatus(bookingId);

  const restartCheckout = (message: string) => {
    setClientRequestId(crypto.randomUUID());
    setStarted(false);
    setError(message);
  };

  useEffect(() => {
    if (status === "confirmed" && bookingId) onConfirmed(bookingId);
    if (status === "expired" || status === "payment_failed") {
      setBusy(false);
      setBookingId(null);
      restartCheckout("The payment didn't go through and your hold was released. You weren't charged.");
    }
  }, [status, bookingId, onConfirmed]);

  async function pay(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    if (!serviceTermsAccepted) {
      setError("Accept the pickup service terms to continue.");
      return;
    }
    setBusy(true);
    setError(null);

    // 1. Let Stripe validate the card form (or open the Apple Pay / Google Pay sheet).
    const submitted = await elements.submit();
    if (submitted.error) {
      setError(submitted.error.message ?? "Check your payment details.");
      setBusy(false);
      return;
    }

    // 2. The server re-checks everything and creates the PaymentIntent for its own price.
    let start;
    try {
      start = await api.startBookingPayment({
        ...draft,
        clientRequestId,
        acceptedServiceTermsVersion: setup.serviceTermsVersion,
        saveCardConsentVersion: saveCard ? setup.savedCardConsent.version : undefined,
      });
    } catch (err) {
      setBusy(false);
      const reason = errorReason(err);
      if (reason === "night-full" || reason === "unit-already-booked" || reason?.startsWith("date-") || reason === "property-not-served") {
        onBackToBooking(errorMessage(err));
      } else if (reason?.startsWith("booking-")) {
        // The earlier attempt's 30-minute hold ran out. Start a fresh checkout.
        restartCheckout("Your earlier hold expired. Press Pay again to book.");
      } else {
        setError(errorMessage(err));
      }
      return;
    }
    if (start.price.totalCents !== totalCents) {
      // Prices changed since the page loaded; never charge an amount the resident didn't see.
      setBusy(false);
      setError(`The price is now ${money(start.price.totalCents)}. Reload the page to see the updated total.`);
      return;
    }
    setStarted(true);

    // 3. Confirm with Stripe. 3-D Secure, if the bank asks for it, happens here.
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      clientSecret: start.clientSecret,
      confirmParams: { return_url: `${window.location.origin}/confirmation/${start.bookingId}` },
      redirect: "if_required",
    });
    if (confirmError) {
      // The hold stays for 30 minutes, so the resident can try another card with the same booking.
      setError(confirmError.message ?? "Your payment didn't go through. Try another card.");
      setBusy(false);
      return;
    }

    // 4. Wait for the server to confirm, which happens only after Stripe's webhook is verified.
    setBookingId(start.bookingId);
  }

  const waiting = !!bookingId && status === "pending_payment";

  return (
    <form onSubmit={pay} className="tl-pay" aria-busy={busy}>
      {isTestMode() && (
        <p className="tl-pay-test">Test mode. Use card 4242 4242 4242 4242, any future date and any CVC. No real charge is made.</p>
      )}

      <PaymentElement
        options={{
          layout: "tabs",
          // "auto" shows Apple Pay or Google Pay only where the browser and device support them.
          wallets: { applePay: "auto", googlePay: "auto", link: "never" },
          fields: { billingDetails: { name: "auto", email: "never", phone: "never" } },
          defaultValues: { billingDetails: { name: draft.contact.name } },
        }}
      />

      <label className="tl-pay-check">
        <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} disabled={busy || started} />
        <span>{setup.savedCardConsent.text}</span>
      </label>

      <label className="tl-pay-check">
        <input type="checkbox" checked={serviceTermsAccepted} onChange={(e) => setServiceTermsAccepted(e.target.checked)} disabled={busy} required />
        <span>
          I agree to the <a href={serviceTermsHref} target="_blank" rel="noreferrer">pickup service terms</a>, including the
          cancellation and refund policy: cancel before 5 PM on the pickup date for a full refund.
        </span>
      </label>

      {error && <p role="alert" className="tl-pay-error">{error}</p>}
      {waiting && !timedOut && <p role="status" className="tl-pay-muted">Payment received. Confirming your pickup…</p>}
      {waiting && timedOut && (
        <p role="status" className="tl-pay-muted">
          Your payment went through, but confirmation is taking longer than usual. Check My Pickups in a few minutes.
          You won't be charged twice.
        </p>
      )}

      <button type="submit" className="tl-pay-button" disabled={!stripe || busy || waiting || !serviceTermsAccepted}>
        {busy || waiting ? "Processing…" : `Pay ${money(totalCents)} and book`}
      </button>
    </form>
  );
}
