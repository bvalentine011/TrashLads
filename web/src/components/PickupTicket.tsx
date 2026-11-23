import type { ReactNode } from "react";
import { formatDate, SCHEDULE } from "../data/rules";
import type { Property } from "../data/types";
import { Bags, Plate, Timeline } from "./ui";

/** The pickup summary used on Review & pay and on the confirmation screen. */
export function PickupTicket({
  heading, top, serviceDate, property, buildingLabel, unitLabel, bagCount, instructions, footer, actions,
}: {
  heading: ReactNode;
  top?: ReactNode;
  serviceDate: string;
  property?: Property;
  buildingLabel?: string;
  unitLabel: string;
  bagCount: number;
  instructions?: string;
  footer?: ReactNode;
  actions?: { date?: ReactNode; location?: ReactNode };
}) {
  const placementStart = property?.placementStartMinutes ?? SCHEDULE.defaultPlacementStartMinutes;
  return (
    <section className="ticket" aria-labelledby="ticket-h">
      <div className="split">
        <h2 id="ticket-h" className="ticket-k">{heading}</h2>
        {actions?.date}
      </div>
      {top}
      <p className="ticket-date">{formatDate(serviceDate)}</p>
      <Timeline light placementStart={placementStart} />
      <div className="where">
        <Plate unit={unitLabel} />
        <div>
          <p style={{ fontWeight: 800, fontSize: "1.1rem" }}>{property?.name ?? ""}</p>
          <p className="muted">{buildingLabel || "No building"}</p>
          <p className="row" style={{ gap: ".5rem", marginTop: ".4rem", fontWeight: 600 }}>
            <Bags count={bagCount} small /> {bagCount} tied bag{bagCount > 1 ? "s" : ""}
          </p>
          {actions?.location}
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>Instructions</dt>
          <dd>{instructions || "Leave tied bags right outside your door."}</dd>
        </div>
      </dl>
      {footer}
    </section>
  );
}
