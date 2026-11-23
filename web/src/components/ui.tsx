import { useEffect, useRef, type ReactNode, type SVGProps } from "react";
import { clock, SCHEDULE, STATUS_LABEL } from "../data/rules";

const icon = (paths: ReactNode) => (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    {paths}
  </svg>
);
export const HomeIcon = icon(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>);
export const CalendarIcon = icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>);
export const ListIcon = icon(<><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>);
export const HelpIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" /></>);
export const RouteIcon = icon(<><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" /></>);
export const UserIcon = icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>);

/** A tied trash bag. Filled, so it reads at small sizes. */
export function TrashBag(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="4 2.5 16 19" fill="currentColor" aria-hidden {...p}>
      <path d="M12 7.4 9 3.6M12 7.4l3-3.8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M10.2 7.2h3.6l.3 1C17.6 9.9 19.2 13 18.8 16.6c-.3 2.9-2.8 4.6-6.8 4.6s-6.5-1.7-6.8-4.6C4.8 13 6.4 9.9 9.9 8.2z" />
      <path d="M9 12.4c-.5 1.3-.4 2.8.3 4" fill="none" stroke="#F6F8F4" strokeOpacity={0.55} strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  );
}

export function Bags({ count, small }: { count: number; small?: boolean }) {
  return (
    <span className={`bagicons${small ? " sm" : ""}`} role="img" aria-label={`${count} bag${count === 1 ? "" : "s"}`}>
      {Array.from({ length: count }, (_, i) => <TrashBag key={i} />)}
    </span>
  );
}

/**
 * Pickup night, 5 PM to 11 PM: bags out (orange) then the pickup window (dusk).
 * The orange segment's width follows the community's own placement time.
 */
export function Timeline({ placementStart = SCHEDULE.defaultPlacementStartMinutes, light, animate, windowCaption = "We pick up. No exact arrival time." }: {
  placementStart?: number; light?: boolean; animate?: boolean; windowCaption?: string;
}) {
  const span = SCHEDULE.windowEndMinutes - SCHEDULE.defaultPlacementStartMinutes; // 5 PM–11 PM
  const pct = (m: number) => ((m - SCHEDULE.defaultPlacementStartMinutes) / span) * 100;
  const outStart = Math.max(0, pct(placementStart));
  const winStart = pct(SCHEDULE.windowStartMinutes);
  return (
    <div
      className={`timeline${light ? " light" : ""}${animate ? " tl-animate" : ""}`}
      role="img"
      aria-label={`Put bags out between ${clock(placementStart)} and ${clock(SCHEDULE.windowStartMinutes)}. We pick up between ${clock(SCHEDULE.windowStartMinutes)} and ${clock(SCHEDULE.windowEndMinutes)}.`}
    >
      <div className="tl-track" aria-hidden>
        <span className="tl-out" style={{ left: `${outStart}%`, width: `${winStart - outStart}%` }} />
        <span className="tl-window" style={{ left: `${winStart}%` }} />
      </div>
      <div className="tl-ticks" aria-hidden>
        <span style={{ left: `${outStart}%` }}>{clock(placementStart)}</span>
        <span style={{ left: `${Math.max(winStart, outStart + 15)}%` }}>{clock(SCHEDULE.windowStartMinutes)}</span>
        <span className="end">{clock(SCHEDULE.windowEndMinutes)}</span>
      </div>
      <div className="tl-caps" aria-hidden style={{ gridTemplateColumns: `${Math.max(winStart, 26)}% 1fr` }}>
        <span className="out" style={{ paddingLeft: `${(outStart / Math.max(winStart, 26)) * 100}%` }}>Bags out</span>
        <span className="win">{windowCaption}</span>
      </div>
    </div>
  );
}

export function Plate({ unit, small, onClick, label }: { unit: string; small?: boolean; onClick?: () => void; label?: string }) {
  const body = (
    <>
      {!small && <span className="k">Unit</span>}
      <span className="v">{unit || "—"}</span>
    </>
  );
  return onClick ? (
    <button className={`plate${small ? " sm" : ""}`} onClick={onClick} aria-label={label ?? `Unit ${unit}`}>{body}</button>
  ) : (
    <div className={`plate${small ? " sm" : ""}`}>{body}</div>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${status}`}>{label ?? STATUS_LABEL[status] ?? status.replace("_", " ")}</span>;
}

/** Native <dialog>, opened while `open` is true. Escape and the backdrop close it. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="dlg-title">
      <div className="dlg">
        <h2 id="dlg-title">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export function shortRef(id: string): string {
  return `TL-${id.replace(/^bk_/, "").slice(0, 6).toUpperCase()}`;
}
