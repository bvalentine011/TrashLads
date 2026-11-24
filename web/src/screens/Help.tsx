import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { shortRef, StatusBadge } from "../components/ui";
import { useData, useLive } from "../data/DataContext";
import { clock, formatDate, SCHEDULE } from "../data/rules";
import type { Booking, SupportCategory, SupportRequest } from "../data/types";

const CATEGORIES: { id: SupportCategory; label: string }[] = [
  { id: "missed_pickup", label: "My bags weren't picked up" },
  { id: "billing", label: "A charge or refund" },
  { id: "damage", label: "Something was damaged or left behind" },
  { id: "account", label: "My account" },
  { id: "other", label: "Something else" },
];

const FAQ = [
  { q: "When do I put my bags out?", a: `Between ${clock(SCHEDULE.defaultPlacementStartMinutes)} and ${clock(SCHEDULE.windowStartMinutes)} on your pickup night, right outside your door. Some communities set a later start; your booking shows yours.` },
  { q: "When will my bags be taken?", a: `Any time between ${clock(SCHEDULE.windowStartMinutes)} and ${clock(SCHEDULE.windowEndMinutes)}. There's no exact arrival time.` },
  { q: "How do I cancel?", a: `In My Pickups, before ${clock(SCHEDULE.cancelCutoffMinutes)} on the pickup date. You get a full refund to your card.` },
  { q: "What if something went wrong?", a: "Report it below, or request a refund from the pickup in My Pickups. The owner reviews every request." },
  { q: "What can't you take?", a: "Loose trash, boxes, furniture, liquids, hazardous waste, or bags over about 30 lb." },
];

export function Help() {
  const { data, user } = useData();
  const mine = useLive<SupportRequest[]>(user ? (cb) => data.watchMySupport(cb) : null, [data, user?.uid]) ?? [];
  const bookings = useLive<Booking[]>(user ? (cb) => data.watchMyBookings(cb) : null, [data, user?.uid]) ?? [];
  const [category, setCategory] = useState<SupportCategory>("missed_pickup");
  const [bookingId, setBookingId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (message.trim().length < 10) return setError("Tell us what happened in at least 10 characters.");
    setBusy(true);
    try {
      await data.createSupportRequest({ category, message: message.trim(), bookingId: bookingId || undefined });
      setMessage("");
      setBookingId("");
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: "2rem" }}>
      <div>
        <h1 className="page-title">Help</h1>
        <p className="page-sub">Answers to common questions, and a way to reach us when something goes wrong.</p>
      </div>

      <section aria-labelledby="faq-h" className="card pad">
        <h2 id="faq-h" className="sec-title">Common questions</h2>
        <dl className="facts" style={{ borderTop: 0, paddingTop: 0, marginTop: "1rem" }}>
          {FAQ.map((f) => (
            <div key={f.q} style={{ gridTemplateColumns: "1fr", gap: ".2rem" }}>
              <dt style={{ fontWeight: 800, color: "var(--forest)", fontSize: "1rem" }}>{f.q}</dt>
              <dd style={{ fontWeight: 400 }}>{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="report-h" className="card pad">
        <h2 id="report-h" className="sec-title">Report a problem</h2>
        {!user ? (
          <p style={{ marginTop: ".75rem" }}><Link to="/signin?next=/help">Sign in</Link> to report a problem, so we can match it to your pickups.</p>
        ) : (
          <form onSubmit={submit} className="stack" style={{ marginTop: "1rem" }} noValidate>
            <div className="grid2">
              <div className="field">
                <label htmlFor="cat">What's it about?</label>
                <select id="cat" className="input" value={category} onChange={(e) => setCategory(e.target.value as SupportCategory)}>
                  {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="bk">Which pickup? <span className="muted">(optional)</span></label>
                <select id="bk" className="input" value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
                  <option value="">Not about a pickup</option>
                  {bookings.slice(0, 12).map((b) => <option key={b.id} value={b.id}>{formatDate(b.serviceDate, "day")}, {shortRef(b.id)}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="msg">What happened?</label>
              <textarea id="msg" className="input" maxLength={2000} value={message} onChange={(e) => { setMessage(e.target.value); setSent(false); }} />
            </div>
            {error && <p className="alert" role="alert">{error}</p>}
            {sent && <p className="note" role="status">Sent. We'll reply by email, usually within a day.</p>}
            <div><button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send report"}</button></div>
          </form>
        )}
      </section>

      {mine.length > 0 && (
        <section aria-labelledby="mine-h">
          <h2 id="mine-h" className="sec-title" style={{ marginBottom: ".75rem" }}>Your reports</h2>
          <ul className="queue">
            {mine.map((r) => (
              <li key={r.id} className="card pad">
                <div className="split">
                  <b>{CATEGORIES.find((c) => c.id === r.category)?.label}</b>
                  <StatusBadge status={r.status} label={{ open: "Open", in_progress: "Being looked at", resolved: "Resolved" }[r.status]} />
                </div>
                <p style={{ marginTop: ".4rem" }}>{r.message}</p>
                {r.ownerNote && <p className="note small" style={{ marginTop: ".6rem" }}>{r.ownerNote}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
