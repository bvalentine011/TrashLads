import { useEffect, useMemo, useState } from "react";
import { Bags, Dialog, Plate, shortRef, StatusBadge } from "../components/ui";
import { useData, useLive } from "../data/DataContext";
import { CAPACITY, clock, easternNow, formatDate, money, SCHEDULE } from "../data/rules";
import type { Booking, BookingStatus, Property, RefundRequest } from "../data/types";

const ON_ROUTE: BookingStatus[] = ["confirmed", "in_progress", "completed", "missed"];

/** "203" → "2", "1105" → "11", "3C" → "3". Unknown shapes go under "Floor not known". */
function floorOf(unit: string): string | null {
  const m = unit.match(/^(\d+)/);
  if (!m) return null;
  return m[1].length >= 3 ? m[1].slice(0, -2) : m[1].length === 1 ? m[1] : null;
}

export function Owner() {
  const { data } = useData();
  const [date, setDate] = useState(easternNow().date);
  const night = useLive<Booking[]>((cb) => data.watchNight(date, cb), [data, date]) ?? [];
  const refunds = useLive<RefundRequest[]>((cb) => data.watchRefundQueue(cb), [data]) ?? [];
  const [properties, setProperties] = useState<Property[]>([]);
  const [open, setOpen] = useState<Booking | null>(null);
  const [missing, setMissing] = useState<Booking | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    data.listProperties().then(setProperties).catch(() => {});
  }, [data]);
  const propName = (id: string) => properties.find((p) => p.id === id)?.name ?? id;

  const counts = useMemo(() => {
    const c = { pending_payment: 0, confirmed: 0, in_progress: 0, completed: 0, missed: 0, canceled: 0 } as Record<string, number>;
    for (const b of night) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [night]);
  const active = night.filter((b) => ON_ROUTE.includes(b.status) || b.status === "pending_payment");
  const stops = active.length;
  const bags = active.reduce((s, b) => s + b.bagCount, 0);
  const booked = night.filter((b) => b.paidAt && b.status !== "canceled").reduce((s, b) => s + b.price.totalCents - b.amountRefundedCents, 0);
  const done = night.filter((b) => b.status === "completed").reduce((s, b) => s + b.price.totalCents - b.amountRefundedCents, 0);
  const pendingRefunds = refunds.filter((r) => r.status === "pending_review");

  const routeGroups = useMemo(() => {
    const byProp = new Map<string, Map<string, Map<string, Booking[]>>>();
    for (const b of [...night].sort((a, b) => a.unitLabel.localeCompare(b.unitLabel, undefined, { numeric: true }))) {
      if (b.status === "pending_payment" || b.status === "expired" || b.status === "payment_failed") continue;
      const bl = byProp.get(b.propertyId) ?? new Map();
      const fl = bl.get(b.buildingLabel || "No building") ?? new Map();
      const key = floorOf(b.unitLabel) ?? "?";
      fl.set(key, [...(fl.get(key) ?? []), b]);
      bl.set(b.buildingLabel || "No building", fl);
      byProp.set(b.propertyId, bl);
    }
    return byProp;
  }, [night]);

  async function act(fn: () => Promise<unknown>, id: string) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const seg = (k: string, v: number) => (v > 0 ? <span key={k} className={`seg-${k}`} style={{ flexGrow: v }} /> : null);
  const legend: [string, string, number][] = [
    ["pend", "Awaiting payment", counts.pending_payment],
    ["conf", "Confirmed", counts.confirmed],
    ["route", "On route", counts.in_progress],
    ["done", "Completed", counts.completed],
    ["miss", "Missed", counts.missed],
  ];

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">{date === easternNow().date ? "Tonight" : formatDate(date)}</h1>
          <p className="page-sub">{formatDate(date)}, {clock(SCHEDULE.windowStartMinutes)}–{clock(SCHEDULE.windowEndMinutes)}</p>
        </div>
        <div className="row">
          <label className="sr-only" htmlFor="night">Night</label>
          <input id="night" type="date" className="input" style={{ width: "auto" }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn btn-primary" disabled={!counts.confirmed || busyId === "start"} onClick={() => act(() => data.ownerStartNight(date), "start")}>
            {counts.in_progress && !counts.confirmed ? "Route started" : "Start route"}
          </button>
        </div>
      </div>

      {error && <p className="alert" role="alert">{error}</p>}

      <section aria-label="Night summary" className="card board">
        <div className="board-main">
          <p className="muted" style={{ fontWeight: 700 }}><span className="board-n" style={{ color: "var(--forest)" }}>{stops}</span>{stops === 1 ? "stop" : "stops"} booked</p>
          <div className="stack-bar" aria-hidden>{legend.map(([k, , v]) => seg(k, v))}</div>
          <dl className="legend">
            {legend.map(([k, label, v]) => (
              <div key={k}><dt><span className={`sw seg-${k}`} aria-hidden />{label}</dt><dd>{v}</dd></div>
            ))}
            <div><dt>Canceled</dt><dd>{counts.canceled}</dd></div>
          </dl>
        </div>
        <div className="board-side">
          {([["Stops", stops, CAPACITY.maxStopsPerNight], ["Bags", bags, CAPACITY.maxBagsPerNight]] as const).map(([label, v, max]) => (
            <div key={label}>
              <p className="cap-row"><span>{label}</span><span className="cap-v">{v}<span className="muted small" style={{ fontWeight: 500 }}> of {max}</span></span></p>
              <div className={`meter${v >= max ? " full" : ""}`} role="meter" aria-label={`${label}: ${v} of ${max}`} aria-valuenow={v} aria-valuemin={0} aria-valuemax={max}>
                <span style={{ width: `${Math.min(100, Math.round((v / max) * 100))}%` }} />
              </div>
            </div>
          ))}
          <div className="money">
            <div><p className="muted small">Paid, net of refunds</p><p className="v">{money(booked)}</p></div>
            <div><p className="muted small">From completed stops</p><p className="v">{money(done)}</p></div>
          </div>
        </div>
      </section>

      {pendingRefunds.length > 0 && <RefundQueue refunds={pendingRefunds} />}

      {routeGroups.size === 0 ? (
        <div className="card empty"><p>No pickups this night</p><p>Bookings appear here as soon as they're paid.</p></div>
      ) : (
        <div className="route">
          {[...routeGroups].map(([pid, buildings]) => {
            const all = [...buildings.values()].flatMap((f) => [...f.values()].flat()).filter((b) => b.status !== "canceled");
            return (
              <section key={pid} className="route-prop" aria-label={propName(pid)}>
                <h2>{propName(pid)} <small>{all.length} stop{all.length === 1 ? "" : "s"}, {all.reduce((s, b) => s + b.bagCount, 0)} bags</small></h2>
                {[...buildings].map(([bname, floors]) => (
                  <div key={bname} className="bldg">
                    <h3>{bname}</h3>
                    {[...floors].sort(([a], [b]) => (a === "?" ? 1 : b === "?" ? -1 : Number(a) - Number(b))).map(([floor, list]) => (
                      <div key={floor} className="floor">
                        <p className="floor-k">{floor === "?" ? "Floor not known" : `Floor ${floor}`}</p>
                        <ul className="stops">
                          {list.map((b) => (
                            <li key={b.id}>
                              <div className={`stop${b.status === "canceled" ? " dim" : ""}`}>
                                <div className="stop-main">
                                  <Plate unit={b.unitLabel} small onClick={() => setOpen(b)} label={`Open unit ${b.unitLabel}`} />
                                  <button className="btn-reset" style={{ textAlign: "left", flex: 1, minWidth: 0 }} onClick={() => setOpen(b)}>
                                    <span className="row" style={{ gap: ".5rem" }}>
                                      <StatusBadge status={b.status} />
                                      {b.locationUnverified && <span className="badge pending_review">Check unit</span>}
                                      {b.refundState !== "none" && <span className="badge">{b.refundState === "full" ? "Refunded" : "Part refunded"}</span>}
                                    </span>
                                    <span className="meta" style={{ marginTop: ".25rem" }}>
                                      <span className="ref-sm">{shortRef(b.id)}</span>
                                      <Bags count={b.bagCount} small />
                                      <span>{money(b.price.totalCents)}</span>
                                    </span>
                                    {b.instructions && <span className="stop-note" style={{ display: "block" }}>“{b.instructions}”</span>}
                                  </button>
                                </div>
                                <div className="stop-actions">
                                  {(b.status === "confirmed" || b.status === "in_progress") && (
                                    <>
                                      <button className="btn btn-dark btn-sm" disabled={busyId === b.id} onClick={() => act(() => data.ownerSetStatus(b.id, "completed"), b.id)}>Mark complete</button>
                                      <button className="btn btn-outline btn-sm" disabled={busyId === b.id} onClick={() => setMissing(b)}>Missed</button>
                                    </>
                                  )}
                                  {(b.status === "completed" || b.status === "missed") && (
                                    <button className="btn btn-outline btn-sm" disabled={busyId === b.id} onClick={() => act(() => data.ownerSetStatus(b.id, "confirmed"), b.id)}>Undo</button>
                                  )}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}

      <StopDialog booking={open} propertyName={open ? propName(open.propertyId) : ""} onClose={() => setOpen(null)} />
      <MissedDialog booking={missing} onClose={() => setMissing(null)} />
    </div>
  );
}

function RefundQueue({ refunds }: { refunds: RefundRequest[] }) {
  const { data } = useData();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(r: RefundRequest, decision: "approve" | "deny") {
    setBusy(r.id);
    setError(null);
    try {
      const dollars = amounts[r.id];
      const cents = dollars ? Math.round(parseFloat(dollars) * 100) : undefined;
      await data.ownerReviewRefund(r.id, decision, decision === "approve" ? cents : undefined, notes[r.id]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card pad" aria-labelledby="rq-h">
      <h2 id="rq-h" className="sec-title">Refund requests to review <span className="badge open" style={{ marginLeft: ".4rem" }}>{refunds.length}</span></h2>
      {error && <p className="alert" role="alert" style={{ marginTop: ".75rem" }}>{error}</p>}
      <ul className="queue" style={{ marginTop: "1rem" }}>
        {refunds.map((r) => (
          <li key={r.id} style={{ borderTop: "1px solid var(--line-soft)", paddingTop: "1rem", display: "grid", gap: ".6rem" }}>
            <div className="split"><b>{shortRef(r.bookingId)}</b><span className="muted small">Up to {money(r.requestedCents)}</span></div>
            <p>“{r.reason}”</p>
            <div className="grid2">
              <div className="field">
                <label htmlFor={`amt-${r.id}`}>Refund amount ($)</label>
                <input id={`amt-${r.id}`} className="input num" inputMode="decimal" placeholder={(r.requestedCents / 100).toFixed(2)} value={amounts[r.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [r.id]: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`note-${r.id}`}>Note to the resident</label>
                <input id={`note-${r.id}`} className="input" placeholder="Required if you deny" value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
              </div>
            </div>
            <div className="row">
              <button className="btn btn-dark btn-sm" disabled={busy === r.id} onClick={() => decide(r, "approve")}>Approve refund</button>
              <button className="btn btn-outline btn-sm" disabled={busy === r.id} onClick={() => decide(r, "deny")}>Deny</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StopDialog({ booking, propertyName, onClose }: { booking: Booking | null; propertyName: string; onClose: () => void }) {
  const { data } = useData();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setAmount(""); setReason(""); setMsg(null); }, [booking?.id]);
  if (!booking) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;
  const left = booking.price.totalCents - booking.amountRefundedCents;

  async function refund() {
    setBusy(true);
    setMsg(null);
    try {
      await data.ownerRefund(booking!.id, reason.trim(), amount ? Math.round(parseFloat(amount) * 100) : undefined);
      setMsg({ ok: true, text: "Refund sent to Stripe." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      await data.ownerSetStatus(booking!.id, "canceled");
      onClose();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Unit ${booking.unitLabel}`}>
      <div className="row"><StatusBadge status={booking.status} /><span className="muted small">{shortRef(booking.id)}</span></div>
      <dl className="facts" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
        <div><dt>Where</dt><dd>{propertyName}, {booking.buildingLabel || "no building"}{booking.locationUnverified ? " (not on the community's unit list)" : ""}</dd></div>
        <div><dt>Bags</dt><dd>{booking.bagCount}</dd></div>
        <div><dt>Resident</dt><dd>{booking.contact.name}, <a href={`tel:${booking.contact.phone}`}>{booking.contact.phone}</a></dd></div>
        {booking.instructions && <div><dt>Instructions</dt><dd>{booking.instructions}</dd></div>}
        {booking.ownerNote && <div><dt>Note</dt><dd>{booking.ownerNote}</dd></div>}
        <div><dt>Paid</dt><dd>{money(booking.price.totalCents)}{booking.amountRefundedCents ? `, ${money(booking.amountRefundedCents)} refunded` : ""}</dd></div>
      </dl>
      {booking.paidAt && left > 0 && (
        <div className="stack" style={{ borderTop: "1px solid var(--line-soft)", paddingTop: "1rem" }}>
          <p className="label">Refund this pickup</p>
          <div className="grid2">
            <div className="field"><label htmlFor="r-amt">Amount ($)</label><input id="r-amt" className="input num" inputMode="decimal" placeholder={(left / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label htmlFor="r-why">Reason</label><input id="r-why" className="input" placeholder="e.g. Crew missed the stop" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          </div>
          <div><button className="btn btn-dark btn-sm" disabled={busy} onClick={refund}>Send refund</button></div>
        </div>
      )}
      {msg && <p className={msg.ok ? "note" : "alert"} role="status">{msg.text}</p>}
      <div className="split">
        {booking.status === "confirmed" ? <button className="btn btn-danger btn-sm" disabled={busy} onClick={cancel}>Cancel pickup</button> : <span />}
        <button className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

function MissedDialog({ booking, onClose }: { booking: Booking | null; onClose: () => void }) {
  const { data } = useData();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setNote(""); setError(null); }, [booking?.id]);
  async function go() {
    if (!booking) return;
    if (note.trim().length < 3) return setError("Add a short note. The resident sees it.");
    setBusy(true);
    try {
      await data.ownerSetStatus(booking.id, "missed", note.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!booking} onClose={onClose} title={booking ? `Mark unit ${booking.unitLabel} missed` : ""}>
      <div className="field">
        <label htmlFor="miss-note">What happened?</label>
        <input id="miss-note" className="input" placeholder="e.g. No bags out by 9 PM" value={note} onChange={(e) => setNote(e.target.value)} />
        <span className="hint">The resident sees this note in My Pickups.</span>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="row">
        <button className="btn btn-dark" disabled={busy} onClick={go}>Mark missed</button>
        <button className="btn btn-outline" onClick={onClose}>Back</button>
      </div>
    </Dialog>
  );
}
