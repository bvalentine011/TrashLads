import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, type SavedCard } from "./api";
import { appearance, getStripe } from "./stripe";

/** Account page: see, remove and add saved cards. Adding one needs explicit consent. */
export function SavedCards({ consent }: { consent: { version: string; text: string } }) {
  const [cards, setCards] = useState<SavedCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // SetupIntent client secret
  const [consented, setConsented] = useState(false);

  const refresh = () => api.listMyCards({}).then(setCards).catch((e) => setError(errorMessage(e)));
  useEffect(() => { refresh(); }, []);

  async function remove(id: string) {
    setError(null);
    try {
      await api.removeMyCard({ paymentMethodId: id });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function startAdd() {
    setError(null);
    try {
      const { clientSecret } = await api.startSaveCard({ consentVersion: consent.version });
      setAdding(clientSecret);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="tl-pay" aria-labelledby="saved-cards-h">
      <h2 id="saved-cards-h">Saved cards</h2>
      {cards === null ? (
        <p className="tl-pay-muted">Loading…</p>
      ) : cards.length === 0 ? (
        <p className="tl-pay-muted">No saved cards. You can save one at checkout or add one here.</p>
      ) : (
        <ul className="tl-cards">
          {cards.map((c) => (
            <li key={c.id}>
              <span>
                {c.wallet ? `${c.wallet.replace("_", " ")} ` : ""}
                {c.brand} ending {c.last4}, expires {c.expMonth}/{c.expYear}
              </span>
              <button onClick={() => remove(c.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <Elements stripe={getStripe()} options={{ clientSecret: adding, appearance }}>
          <AddCardForm onDone={() => { setAdding(null); setConsented(false); setTimeout(refresh, 1500); }} />
        </Elements>
      ) : (
        <>
          <label className="tl-pay-check">
            <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
            <span>{consent.text}</span>
          </label>
          <button className="tl-pay-button" onClick={startAdd} disabled={!consented}>Add a card</button>
        </>
      )}
      {error && <p role="alert" className="tl-pay-error">{error}</p>}
    </section>
  );
}

function AddCardForm({ onDone }: { onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    const { error: err } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/account` },
      redirect: "if_required",
    });
    setBusy(false);
    if (err) setError(err.message ?? "The card couldn't be saved.");
    else onDone();
  }

  return (
    <form onSubmit={save}>
      <PaymentElement options={{ wallets: { applePay: "auto", googlePay: "auto", link: "never" } }} />
      {error && <p role="alert" className="tl-pay-error">{error}</p>}
      <button className="tl-pay-button" disabled={!stripe || busy}>{busy ? "Saving…" : "Save card"}</button>
    </form>
  );
}
