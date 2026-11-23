import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PickupTicket } from "../components/PickupTicket";
import { shortRef, StatusBadge } from "../components/ui";
import { useData, useLive } from "../data/DataContext";
import { addDays, clock, formatDate, money, SCHEDULE } from "../data/rules";
import type { Booking, Property } from "../data/types";

export function Confirmation() {
  const { id = "" } = useParams();
  const { data } = useData();
  const booking = useLive<Booking | null>((cb) => data.watchBooking(id, cb), [id]);
  const [property, setProperty] = useState<Property>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (booking) data.listProperties().then((ps) => setProperty(ps.find((p) => p.id === booking.propertyId)));
  }, [data, booking?.propertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (booking === undefined) return <p className="muted">Loading…</p>;
  if (booking === null) return <div className="empty"><p>Pickup not found</p><p>Check My Pickups for your bookings.</p><Link className="btn btn-dark" to="/pickups">My Pickups</Link></div>;

  const confirmed = booking.status !== "pending_payment";
  const ref = shortRef(booking.id);
  const placementStart = property?.placementStartMinutes ?? SCHEDULE.defaultPlacementStartMinutes;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
    } catch {
      /* clipboard blocked: the reference is on screen */
    }
  };

  return (
    <div className="confirm">
      <header>
        <h1 className="page-title">{confirmed ? "Pickup confirmed" : "Confirming your pickup…"}</h1>
        <p className="page-sub">
          {confirmed
            ? `Your payment went through. Put your bags out on ${formatDate(booking.serviceDate)} between ${clock(placementStart)} and ${clock(SCHEDULE.windowStartMinutes)}.`
            : "Your payment is going through. This page updates on its own in a few seconds."}
        </p>
      </header>

      <PickupTicket
        heading="Pickup reference"
        top={
          <>
            <div className="split" style={{ marginTop: ".1rem" }}>
              <p className="ref">{ref}</p>
              <button className="btn btn-outline btn-sm" onClick={copy}>{copied ? "Copied" : "Copy reference"}</button>
            </div>
            <div className="row" style={{ margin: ".75rem 0 1.25rem", paddingBottom: "1.25rem", borderBottom: "1px solid var(--line-soft)" }}>
              <StatusBadge status={booking.status} />
              <span className="muted small">Paid {money(booking.price.totalCents)}{booking.amountRefundedCents ? `, ${money(booking.amountRefundedCents)} refunded` : ""}</span>
            </div>
          </>
        }
        serviceDate={booking.serviceDate}
        property={property}
        buildingLabel={booking.buildingLabel}
        unitLabel={booking.unitLabel}
        bagCount={booking.bagCount}
        instructions={booking.instructions}
      />

      <section className="card pad" aria-labelledby="rules-h">
        <h2 id="rules-h" className="sec-title">Leaving your bags out</h2>
        <ul className="rules" style={{ marginTop: "1rem" }}>
          <li>Tie bags closed and set them right outside your door, no earlier than {clock(placementStart)}.</li>
          <li>Have them out by {clock(SCHEDULE.windowStartMinutes)}. The crew comes any time until {clock(SCHEDULE.windowEndMinutes)}.</li>
          <li>Need to cancel? Do it before {clock(SCHEDULE.cancelCutoffMinutes)} on the pickup date for a full refund.</li>
        </ul>
      </section>

      <section className="card pad" aria-labelledby="rem-h">
        <h2 id="rem-h" className="sec-title">Your reminders</h2>
        <p className="muted small" style={{ marginTop: ".25rem" }}>We'll send these once text and email reminders are switched on.</p>
        <ol className="reminders">
          <li><p className="k">Now</p><p>Booking confirmation with your reference, {ref}.</p></li>
          <li><p className="k">{formatDate(addDays(booking.serviceDate, -1), "day")}, evening</p><p>Reminder that pickup is tomorrow night.</p></li>
          <li><p className="k">{formatDate(booking.serviceDate, "day")}, {clock(placementStart - 60)}</p><p>Bags out between {clock(placementStart)} and {clock(SCHEDULE.windowStartMinutes)}.</p></li>
          <li><p className="k">After pickup</p><p>A note when your bags are taken down.</p></li>
        </ol>
      </section>

      <div className="row" style={{ marginTop: ".5rem" }}>
        <Link to="/pickups" className="btn btn-dark">View My Pickups</Link>
        <Link to="/book" className="btn btn-outline">Book another pickup</Link>
      </div>
    </div>
  );
}
