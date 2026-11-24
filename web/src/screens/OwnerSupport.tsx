import { useState } from "react";
import { shortRef, StatusBadge } from "../components/ui";
import { useData, useLive } from "../data/DataContext";
import type { SupportRequest, SupportStatus } from "../data/types";

const CATEGORY: Record<string, string> = {
  missed_pickup: "Missed pickup", billing: "Charge or refund", damage: "Damage or left behind", account: "Account", other: "Other",
};
const STATUS: Record<SupportStatus, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };

export function OwnerSupport() {
  const { data } = useData();
  const all = useLive<SupportRequest[]>((cb) => data.watchSupportQueue(cb), [data]);
  const [tab, setTab] = useState<SupportStatus>("open");
  const list = (all ?? []).filter((r) => r.status === tab);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Support</h1>
          <p className="page-sub">Reports from residents. Replies you add here show on their Help page.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Support status">
        {(Object.keys(STATUS) as SupportStatus[]).map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} className="tab" onClick={() => setTab(s)}>
            {STATUS[s]} <span className="n">{(all ?? []).filter((r) => r.status === s).length}</span>
          </button>
        ))}
      </div>
      {all === undefined ? <p className="muted">Loading…</p> : list.length === 0 ? (
        <div className="card empty"><p>Nothing {STATUS[tab].toLowerCase()}</p><p>New reports from the Help page land in Open.</p></div>
      ) : (
        <ul className="queue">{list.map((r) => <SupportItem key={r.id} r={r} />)}</ul>
      )}
    </>
  );
}

function SupportItem({ r }: { r: SupportRequest }) {
  const { data } = useData();
  const [note, setNote] = useState(r.ownerNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function set(status: SupportStatus) {
    setBusy(true);
    setError(null);
    try {
      await data.ownerUpdateSupport(r.id, status, note.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="card pad" style={{ display: "grid", gap: ".75rem" }}>
      <div className="split">
        <b>{CATEGORY[r.category]}{r.bookingId ? `, ${shortRef(r.bookingId)}` : ""}</b>
        <StatusBadge status={r.status} label={STATUS[r.status]} />
      </div>
      <p>{r.message}</p>
      <p className="muted small">
        {r.contactName}, <a href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a>, {new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </p>
      <div className="field">
        <label htmlFor={`n-${r.id}`}>Reply to the resident</label>
        <input id={`n-${r.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sorry about that. We've refunded the pickup." />
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="row">
        {r.status !== "in_progress" && r.status !== "resolved" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => set("in_progress")}>Mark in progress</button>}
        {r.status !== "resolved" && <button className="btn btn-dark btn-sm" disabled={busy} onClick={() => set("resolved")}>Resolve</button>}
        {r.status === "resolved" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => set("open")}>Reopen</button>}
      </div>
    </li>
  );
}
