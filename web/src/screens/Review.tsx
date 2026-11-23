import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { PickupTicket } from "../components/PickupTicket";
import { useData } from "../data/DataContext";
import { useDraft } from "../data/draft";
import { money, PRICING, totalFor } from "../data/rules";
import type { BookingDraft, Property } from "../data/types";
import { CheckoutPayment } from "../payments/CheckoutPayment";

export function Review() {
  const { data } = useData();
  const { draft, setDraft } = useDraft();
  const nav = useNavigate();
  const [property, setProperty] = useState<Property>();
  const [doneId, setDoneId] = useState<string | null>(null);
  useEffect(() => {
    if (draft) data.listProperties().then((ps) => setProperty(ps.find((p) => p.id === draft.propertyId)));
  }, [data, draft]);

  // Checked first: clearing the draft after payment must not bounce back to Book.
  if (doneId) return <Navigate to={`/confirmation/${doneId}`} replace />;
  if (!draft) return <Navigate to="/book" replace />;

  const done = (bookingId: string) => {
    setDoneId(bookingId);
    setDraft(null);
  };
  const back = (message: string) => nav("/book", { state: { message } });
  const total = totalFor(draft.bagCount);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Review &amp; pay</h1>
          <p className="page-sub">Check the details, then pay to confirm your pickup.</p>
        </div>
      </div>
      <div className="review">
        <PickupTicket
          heading="Your pickup"
          serviceDate={draft.serviceDate}
          property={property}
          buildingLabel={draft.buildingLabel}
          unitLabel={draft.unitLabel}
          bagCount={draft.bagCount}
          instructions={draft.instructions}
          actions={{
            date: <Link to="/book" className="btn-ghost small">Change date or bags</Link>,
            location: <Link to="/book" className="btn-ghost small">Change location</Link>,
          }}
        />
        <div className="pay-panel">
          <section className="order" aria-label="Order summary">
            <div className="sum-row"><span>Pickup fee</span><span>{money(PRICING.baseFeeCents)}</span></div>
            <div className="sum-row"><span>{draft.bagCount} bag{draft.bagCount > 1 ? "s" : ""} × {money(PRICING.perBagCents)}</span><span>{money(PRICING.perBagCents * draft.bagCount)}</span></div>
            <div className="sum-row sum-total"><span>Total</span><span>{money(total)}</span></div>
          </section>
          <section className="card pad" aria-labelledby="pay-h">
            <h2 id="pay-h" className="sec-title" style={{ marginBottom: "1rem" }}>Payment</h2>
            {data.mode === "demo" ? (
              <DemoCheckout draft={draft} total={total} onConfirmed={done} onBack={back} />
            ) : (
              <CheckoutPayment draft={draft} serviceTermsHref="/service-terms" onConfirmed={done} onBackToBooking={back} />
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/** Demo mode stand-in for the Stripe Payment Element. Same consent boxes, no real payment. */
function DemoCheckout({ draft, total, onConfirmed, onBack }: { draft: BookingDraft; total: number; onConfirmed: (id: string) => void; onBack: (m: string) => void }) {
  const { data } = useData();
  const [saveCard, setSaveCard] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(e: FormEvent) {
    e.preventDefault();
    if (!terms) return setError("Accept the pickup service terms to continue.");
    setBusy(true);
    setError(null);
    try {
      onConfirmed(await data.demoCheckout!(draft, { saveCard }));
    } catch (err) {
      const msg = (err as Error).message;
      if (/full|already has a pickup/.test(msg)) onBack(msg);
      else setError(msg);
      setBusy(false);
    }
  }

  return (
    <form className="tl-pay" onSubmit={pay}>
      <p className="tl-pay-test">Demo payment. On the live site this is Stripe's secure card form, with Apple Pay or Google Pay on supported devices.</p>
      <div className="wallets" aria-hidden>
        <span className="wallet" style={{ display: "grid", placeItems: "center" }}>Apple Pay</span>
        <span className="wallet" style={{ display: "grid", placeItems: "center" }}>Google Pay</span>
      </div>
      <div className="fake-card">
        <div className="field"><label htmlFor="cc">Card number</label><input id="cc" className="input num" defaultValue="4242 4242 4242 4242" readOnly /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="exp">Expiry</label><input id="exp" className="input num" defaultValue="12 / 30" readOnly /></div>
          <div className="field"><label htmlFor="cvc">CVC</label><input id="cvc" className="input num" defaultValue="123" readOnly /></div>
        </div>
      </div>
      <label className="tl-pay-check">
        <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} disabled={busy} />
        <span>Save this card to my Trash Lad account so I can use it for future bookings. I can remove it at any time from my account. Trash Lad will only charge it when I book.</span>
      </label>
      <label className="tl-pay-check">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} disabled={busy} />
        <span>I agree to the <Link to="/service-terms" target="_blank">pickup service terms</Link>, including the cancellation and refund policy: cancel before 5 PM on the pickup date for a full refund.</span>
      </label>
      {error && <p className="tl-pay-error" role="alert">{error}</p>}
      <button className="tl-pay-button" disabled={busy || !terms}>{busy ? "Processing…" : `Pay ${money(total)} and book`}</button>
    </form>
  );
}
