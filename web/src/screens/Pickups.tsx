import { useState } from "react";
import { Link } from "react-router-dom";
import { Bags, Dialog, shortRef, StatusBadge } from "../components/ui";
import { useData, useLive } from "../data/DataContext";
import { canCancel, clock, easternNow, formatDate, money, SCHEDULE } from "../data/rules";
import type { Booking, RefundRequest } from "../data/types";

type Tab = "upcoming" | "past" | "canceled";
const UPCOMING = ["pending_payment", "confirmed", "in_progress"];

export function Pickups() {
  const { data } = useData();
  const bookings = useLive<Booking[]>((cb) => data.watchMyBookings(cb), [data]);
  const refunds = useLive<RefundRequest[]>((cb) => data.watchMyRefundRequests(cb), [data]) ?? [];
  const [tab, setTab] = useState<Tab>("upcoming");
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [asking, setAsking] = useState<Booking | null>(null);

  const today = easternNow().date;
  const groups: Record<Tab, Booking[]> = { upcoming: [], past: [], canceled: [] };
  for (const b of bookings ?? []) {
    if (b.status === "canceled") groups.canceled.push(b);
    else if (UPCOMING.includes(b.status) && b.serviceDate >= today) groups.upcoming.push(b);
    else if (b.status !== "expired") groups.past.push(b);
  }
  groups.upcoming.reverse();
  const list = groups[tab];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">My pickups</h1>
          <p className="page-sub">Cancel before {clock(SCHEDULE.cancelCutoffMinutes)} on the pickup date for a full refund.</p>
        </div>
        <Link to="/book" className="btn btn-primary">Book a pickup</Link>
      </div>

      <div className="tabs" role="tablist" aria-label="Pickups">
        {(["upcoming", "past", "canceled"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="tab" onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)} <span className="n">{groups[t].length}</span>
          </button>
        ))}
      </div>

      {bookings === undefined ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <div className="card empty">
          <p>{tab === "upcoming" ? "No upcoming pickups" : tab === "past" ? "No past pickups yet" : "No canceled pickups"}</p>
          {tab === "upcoming" && <p style={{ marginBottom: "1rem" }}>Book a weeknight and we'll take your bags down.</p>}
          {tab === "upcoming" && <Link to="/book" className="btn btn-dark">Book a pickup</Link>}
        </div>
      ) : (
        <ul className="cards">
          {list.map((b) => {
            const req = refunds.find((r) => r.bookingId === b.id && r.origin !== "customer_cancel");
            return (
              <li key={b.id} className="card pad" style={{ display: "grid", gap: ".9rem" }}>
                <div className="split" style={{ alignItems: "flex-start" }}>
                  <div>
                    <p className="card-date">{formatDate(b.serviceDate)}</p>
                    <p className="muted small">Between {clock(SCHEDULE.windowStartMinutes)} and {clock(SCHEDULE.windowEndMinutes)}</p>
                  </div>
                  <StatusBadge status={b.status} />
                </div>
                <p className="muted small">Unit {b.unitLabel}{b.buildingLabel ? `, ${b.buildingLabel}` : ""}</p>
                <div className="meta">
                  <span className="ref-sm">{shortRef(b.id)}</span>
                  <Bags count={b.bagCount} small />
                  <b>{money(b.price.totalCents)}</b>
                  {b.amountRefundedCents > 0 && <span className="muted">{money(b.amountRefundedCents)} refunded</span>}
                </div>
                {b.ownerNote && <p className="note small">{b.ownerNote}</p>}
                {req && (
                  <p className="small">
                    Refund request: <StatusBadge status={req.status} label={{ pending_review: "Waiting for review", approved: "Approved", refunded: "Refunded", denied: "Not approved", failed: "Being retried" }[req.status]} />
                    {req.reviewNote && <span className="muted"> {req.reviewNote}</span>}
                  </p>
                )}
                <div className="row">
                  <Link to={`/confirmation/${b.id}`} className="btn btn-outline btn-sm">Details</Link>
                  {b.status === "confirmed" && canCancel(b.serviceDate) && (
                    <button className="btn btn-danger btn-sm" onClick={() => setCancelling(b)}>Cancel pickup</button>
                  )}
                  {b.paidAt && b.refundState !== "full" && !req && !(b.status === "confirmed" && canCancel(b.serviceDate)) && b.status !== "canceled" && (
                    <button className="btn btn-outline btn-sm" onClick={() => setAsking(b)}>Request a refund</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CancelDialog booking={cancelling} onClose={() => setCancelling(null)} />
      <RefundDialog booking={asking} onClose={() => setAsking(null)} />
    </>
  );
}

function CancelDialog({ booking, onClose }: { booking: Booking | null; onClose: () => void }) {
  const { data } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (!booking) return;
    setBusy(true);
    setError(null);
    try {
      const r = await data.cancelBooking(booking.id);
      if (!r.canceled) setError(`It's past ${clock(SCHEDULE.cancelCutoffMinutes)} on the pickup date, so this pickup can't be canceled. You can request a refund instead.`);
      else onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!booking} onClose={onClose} title="Cancel this pickup?">
      {booking && <p>{formatDate(booking.serviceDate)}, unit {booking.unitLabel}. You'll get a full refund of {money(booking.price.totalCents - booking.amountRefundedCents)} to your card, usually within 5–10 business days.</p>}
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="row">
        <button className="btn btn-danger" onClick={go} disabled={busy}>{busy ? "Canceling…" : "Cancel pickup"}</button>
        <button className="btn btn-outline" onClick={onClose}>Keep it</button>
      </div>
    </Dialog>
  );
}

function RefundDialog({ booking, onClose }: { booking: Booking | null; onClose: () => void }) {
  const { data } = useData();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (!booking) return;
    if (reason.trim().length < 10) return setError("Tell us what happened in at least 10 characters.");
    setBusy(true);
    setError(null);
    try {
      await data.requestRefund(booking.id, reason.trim());
      setReason("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!booking} onClose={onClose} title="Request a refund">
      <p className="muted">The owner reviews every request and replies here, usually within a day.</p>
      <div className="field">
        <label htmlFor="reason">What happened?</label>
        <textarea id="reason" className="input" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
        <button className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
