import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../data/DataContext";
import type { Property } from "../data/types";
import { api } from "../payments/api";
import { SavedCards } from "../payments/SavedCards";

const SAVE_CONSENT = {
  version: "2026-11-01",
  text: "Save this card to my Trash Lad account so I can use it for future bookings. I can remove it at any time from my account. Trash Lad will only charge it when I book.",
};

export function Account() {
  const { data, user } = useData();
  const nav = useNavigate();
  const [properties, setProperties] = useState<Property[]>([]);
  const [f, setF] = useState({
    name: user?.name ?? "", phone: user?.phone ?? "",
    propertyId: user?.defaults?.propertyId ?? "", buildingLabel: user?.defaults?.buildingLabel ?? "", unitLabel: user?.defaults?.unitLabel ?? "", instructions: user?.defaults?.instructions ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [consent, setConsent] = useState(SAVE_CONSENT);

  useEffect(() => {
    data.listProperties().then(setProperties).catch(() => {});
    if (data.mode === "live" && !user?.isOwner) api.getCheckoutSetup({}).then((s) => setConsent(s.savedCardConsent)).catch(() => {});
  }, [data, user?.isOwner]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await data.updateProfile({
        name: f.name.trim(), phone: f.phone,
        defaults: { propertyId: f.propertyId, buildingLabel: f.buildingLabel.trim(), unitLabel: f.unitLabel.trim().toUpperCase(), instructions: f.instructions.trim() },
      });
      setMsg({ ok: true, text: "Saved. Your details will be filled in next time you book." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: "1.5rem", maxWidth: 760 }}>
      <div className="split">
        <div>
          <h1 className="page-title">Account</h1>
          <p className="page-sub">{user?.email}</p>
        </div>
        <button className="btn btn-outline" onClick={async () => { await data.signOut(); nav("/"); }}>Sign out</button>
      </div>

      <form className="card pad stack" onSubmit={save}>
        <h2 className="sec-title">{user?.isOwner ? "Your details" : "Your details and usual pickup spot"}</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="a-name">Name</label><input id="a-name" className="input" value={f.name} onChange={set("name")} autoComplete="name" /></div>
          <div className="field"><label htmlFor="a-phone">Mobile phone</label><input id="a-phone" className="input" type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" /></div>
        </div>
        {!user?.isOwner && (
          <>
            <div className="field">
              <label htmlFor="a-prop">Community</label>
              <select id="a-prop" className="input" value={f.propertyId} onChange={set("propertyId")}>
                <option value="">None saved</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor="a-bldg">Building</label><input id="a-bldg" className="input" value={f.buildingLabel} onChange={set("buildingLabel")} /></div>
              <div className="field"><label htmlFor="a-unit">Unit</label><input id="a-unit" className="input" value={f.unitLabel} onChange={set("unitLabel")} /></div>
            </div>
            <div className="field"><label htmlFor="a-ins">Usual instructions</label><input id="a-ins" className="input" value={f.instructions} onChange={set("instructions")} maxLength={280} /></div>
          </>
        )}
        {msg && <p className={msg.ok ? "note" : "alert"} role="status">{msg.text}</p>}
        <div><button className="btn btn-dark" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
      </form>

      {!user?.isOwner && (
        data.mode === "live" ? (
          <div className="card pad"><SavedCards consent={consent} /></div>
        ) : (
          <section className="card pad">
            <h2 className="sec-title">Saved cards</h2>
            <p className="muted" style={{ marginTop: ".5rem" }}>In demo mode there are no saved cards. On the live site, cards you choose to save at checkout appear here, and you can remove them.</p>
          </section>
        )
      )}
    </div>
  );
}
