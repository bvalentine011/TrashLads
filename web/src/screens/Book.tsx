import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bags, Timeline } from "../components/ui";
import { useData } from "../data/DataContext";
import { useDraft } from "../data/draft";
import { bookableDates, CAPACITY, clock, formatDate, money, PRICING, SCHEDULE, totalFor, weekday } from "../data/rules";
import type { Property } from "../data/types";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function Book() {
  const { data, user } = useData();
  const { draft, setDraft } = useDraft();
  const nav = useNavigate();
  const flash = (useLocation().state as { message?: string } | null)?.message;
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [full, setFull] = useState<Set<string>>(new Set());
  const d0 = user?.defaults;
  const [f, setF] = useState({
    propertyId: draft?.propertyId ?? d0?.propertyId ?? "",
    buildingLabel: draft?.buildingLabel ?? d0?.buildingLabel ?? "",
    unitLabel: draft?.unitLabel ?? d0?.unitLabel ?? "",
    serviceDate: draft?.serviceDate ?? "",
    bagCount: (draft?.bagCount ?? 1) as 1 | 2 | 3,
    instructions: draft?.instructions ?? d0?.instructions ?? "",
    name: draft?.contact.name ?? user?.name ?? "",
    phone: draft?.contact.phone ?? user?.phone ?? "",
    email: draft?.contact.email ?? user?.email ?? "",
    placement: draft?.acceptedPlacementPolicy ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fill in saved details once the account has loaded, without overwriting anything typed.
  useEffect(() => {
    if (!user) return;
    setF((x) => ({
      ...x,
      propertyId: x.propertyId || user.defaults?.propertyId || "",
      buildingLabel: x.buildingLabel || user.defaults?.buildingLabel || "",
      unitLabel: x.unitLabel || user.defaults?.unitLabel || "",
      instructions: x.instructions || user.defaults?.instructions || "",
      name: x.name || user.name,
      phone: x.phone || user.phone || "",
      email: x.email || user.email,
    }));
  }, [user]);

  const dates = useMemo(() => bookableDates(new Date(), full), [full]);
  useEffect(() => {
    data.listProperties().then(setProperties).catch(() => setProperties([]));
    data
      .nightTotals(bookableDates().map((d) => d.date))
      .then((t) => setFull(new Set(Object.entries(t).filter(([, v]) => v.stops >= CAPACITY.maxStopsPerNight || v.bags + 1 > CAPACITY.maxBagsPerNight).map(([k]) => k))))
      .catch(() => {});
  }, [data]);

  const property = properties?.find((p) => p.id === f.propertyId);
  const placementStart = property?.placementStartMinutes ?? SCHEDULE.defaultPlacementStartMinutes;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  function validate() {
    const e: Record<string, string> = {};
    if (!f.propertyId) e.propertyId = "Choose your community.";
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{0,15}$/.test(f.unitLabel.trim())) e.unitLabel = "Enter your unit, like 204 or 12-B.";
    if (!f.serviceDate) e.serviceDate = "Choose a night.";
    if (f.name.trim().length < 2) e.name = "Enter your name.";
    if (f.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length !== 10) e.phone = "Enter a 10-digit phone number.";
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = "Enter a valid email or leave it blank.";
    if (!f.placement) e.placement = "Agree to the placement rules to continue.";
    return e;
  }

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      document.getElementById(Object.keys(e)[0])?.focus();
      return;
    }
    setDraft({
      propertyId: f.propertyId,
      buildingLabel: f.buildingLabel.trim() || undefined,
      unitLabel: f.unitLabel.trim().toUpperCase(),
      serviceDate: f.serviceDate,
      bagCount: f.bagCount,
      instructions: f.instructions.trim() || undefined,
      contact: { name: f.name.trim(), phone: f.phone, email: f.email.trim() || undefined },
      acceptedPlacementPolicy: true,
    });
    nav(user ? "/review" : "/signin?next=/review");
  }

  const err = (k: string) => (errors[k] ? <p className="err" id={`${k}-err`}>{errors[k]}</p> : null);
  const inv = (k: string) => ({ "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? `${k}-err` : undefined });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Book a pickup</h1>
          <p className="page-sub">Weeknights, 6 to 11 PM. Same-day booking closes at 8 PM.</p>
        </div>
      </div>
      {flash && <p className="alert" role="alert" style={{ marginBottom: "1rem" }}>{flash}</p>}

      <form className="book" onSubmit={submit} noValidate>
        <div className="form">
          <section className="fsec" aria-labelledby="loc-h">
            <h2 id="loc-h">Pickup location</h2>
            <div className="body">
              <div className="field">
                <label htmlFor="propertyId">Apartment community</label>
                <select id="propertyId" className="input" value={f.propertyId} onChange={(e) => set("propertyId", e.target.value)} {...inv("propertyId")}>
                  <option value="">Choose your community</option>
                  {properties?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {err("propertyId")}
                {properties?.length === 0 && <p className="hint">No communities are taking bookings right now.</p>}
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="buildingLabel">Building <span className="muted">(if any)</span></label>
                  <input id="buildingLabel" className="input" list="buildings" value={f.buildingLabel} onChange={(e) => set("buildingLabel", e.target.value)} maxLength={40} />
                  <datalist id="buildings">{property?.buildings?.map((b) => <option key={b.label} value={b.label} />)}</datalist>
                </div>
                <div className="field">
                  <label htmlFor="unitLabel">Unit</label>
                  <input id="unitLabel" className="input" value={f.unitLabel} onChange={(e) => set("unitLabel", e.target.value)} maxLength={16} autoComplete="address-line2" {...inv("unitLabel")} />
                  {err("unitLabel")}
                </div>
              </div>
            </div>
          </section>

          <section className="fsec" aria-labelledby="bags-h">
            <h2 id="bags-h">How many bags?</h2>
            <div className="body">
              <div className="bags" role="radiogroup" aria-label="Number of bags">
                {PRICING.bagCounts.map((n) => (
                  <button type="button" key={n} role="radio" aria-checked={f.bagCount === n} className="bagopt" onClick={() => set("bagCount", n)}>
                    <Bags count={n} />
                    <span className="n">{n} bag{n > 1 ? "s" : ""}</span>
                    <span className="p">{money(totalFor(n))}</span>
                  </button>
                ))}
              </div>
              <p className="muted small">Standard kitchen bags, tied, up to about 30 lb each.</p>
            </div>
          </section>

          <section className="fsec" aria-labelledby="date-h">
            <h2 id="date-h">Choose a night</h2>
            <div className="body">
              <div className="dates" role="radiogroup" aria-label="Pickup date" id="serviceDate" tabIndex={-1} {...inv("serviceDate")}>
                {DOW.map((d) => <span key={d} className="dow" aria-hidden>{d}</span>)}
                {dates.map((d) => (
                  <button
                    type="button" key={d.date} role="radio" aria-checked={f.serviceDate === d.date} disabled={!d.available}
                    aria-label={`${formatDate(d.date)}${d.isToday ? ", today" : ""}${d.reason ? `, ${d.reason}` : ""}`}
                    className="date" style={{ gridColumnStart: weekday(d.date) }} onClick={() => set("serviceDate", d.date)}
                  >
                    <span className="d-main">{formatDate(d.date, "short")}</span>
                    {d.isToday && d.available && <span className="d-sub">Today</span>}
                    {d.reason && <span className="d-sub">{d.reason}</span>}
                  </button>
                ))}
              </div>
              {err("serviceDate")}
              <Timeline light placementStart={placementStart} />
            </div>
          </section>

          <section className="fsec" aria-labelledby="rules-h">
            <h2 id="rules-h">Before pickup night</h2>
            <div className="body">
              <ul className="rules">
                <li>Tie bags closed and put them right outside your door between {clock(placementStart)} and {clock(SCHEDULE.windowStartMinutes)}.</li>
                <li>No loose trash, boxes, furniture, liquids, hazardous waste or bags over about 30 lb.</li>
                <li>Leave bags where the crew can reach them without entering your unit.</li>
                <li>Follow your community's own trash rules. Unsafe items are left behind.</li>
              </ul>
              <label className="check" id="placement" tabIndex={-1}>
                <input type="checkbox" checked={f.placement} onChange={(e) => set("placement", e.target.checked)} {...inv("placement")} />
                <span>I'll follow these placement rules.</span>
              </label>
              {err("placement")}
              <div className="field">
                <label htmlFor="instructions">Pickup instructions <span className="muted">(optional)</span></label>
                <textarea id="instructions" className="input" maxLength={280} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="Gate code, which side of the door, anything the crew should know" />
              </div>
            </div>
          </section>

          <section className="fsec" aria-labelledby="contact-h">
            <h2 id="contact-h">Contact</h2>
            <div className="body">
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" className="input" autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} {...inv("name")} />
                {err("name")}
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="phone">Mobile phone</label>
                  <input id="phone" className="input" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} {...inv("phone")} />
                  {err("phone")}
                </div>
                <div className="field">
                  <label htmlFor="email">Email <span className="muted">(optional)</span></label>
                  <input id="email" className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} {...inv("email")} />
                  {err("email")}
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside className="card pad summary" aria-label="Summary">
          <h2 className="sec-title">Summary</h2>
          <div style={{ marginTop: ".75rem" }}>
            <div className="sum-row"><span>Night</span><b>{f.serviceDate ? formatDate(f.serviceDate, "day") : "Not chosen"}</b></div>
            <div className="sum-row"><span>Community</span><b>{property?.name ?? "Not chosen"}</b></div>
            <div className="sum-row"><span>Pickup fee</span><span>{money(PRICING.baseFeeCents)}</span></div>
            <div className="sum-row"><span>{f.bagCount} bag{f.bagCount > 1 ? "s" : ""} × {money(PRICING.perBagCents)}</span><span>{money(PRICING.perBagCents * f.bagCount)}</span></div>
            <div className="sum-row sum-total"><span>Total</span><span>{money(totalFor(f.bagCount))}</span></div>
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: "100%", marginTop: "1rem" }}>Review and pay</button>
          <p className="muted small" style={{ marginTop: ".6rem" }}>You won't be charged until you pay on the next screen.</p>
        </aside>
      </form>
    </>
  );
}
