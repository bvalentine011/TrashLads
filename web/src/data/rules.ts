/**
 * Display copies of the server's business rules (functions/src/config.ts).
 * The server re-checks every one of these, so a mismatch can only cause a
 * clear error at checkout, never a wrong charge. Keep them in step anyway.
 */
export const PRICING = { baseFeeCents: 800, perBagCents: 300, bagCounts: [1, 2, 3] as const };
export const CAPACITY = { maxStopsPerNight: 25, maxBagsPerNight: 60 };
export const SCHEDULE = {
  windowStartMinutes: 18 * 60,
  windowEndMinutes: 23 * 60,
  defaultPlacementStartMinutes: 17 * 60,
  sameDayCutoffMinutes: 20 * 60,
  cancelCutoffMinutes: 17 * 60,
  bookingHorizonDays: 21,
  closedDates: ["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25", "2027-01-01"] as readonly string[],
  closedReasons: { "2026-11-26": "Thanksgiving", "2026-11-27": "Holiday", "2026-12-24": "Holiday", "2026-12-25": "Christmas", "2027-01-01": "New Year's Day" } as Record<string, string>,
};
export const TERMS = { registrationTermsVersion: "2026-11-01" };

export const totalFor = (bags: number) => PRICING.baseFeeCents + PRICING.perBagCents * bags;

export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 });

/** "6 PM", "5:30 PM" */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** Today's date and time in New York, whatever the device's time zone. */
export function easternNow(now = new Date()): { date: string; minutes: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

export function formatDate(iso: string, style: "long" | "short" | "day" = "long"): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const opts: Intl.DateTimeFormatOptions =
    style === "long" ? { weekday: "long", month: "long", day: "numeric" } : style === "short" ? { month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" };
  return d.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export type DateState = { date: string; available: boolean; reason?: string; isToday: boolean };

/** Weeknights from today through the booking horizon, with why any are closed. */
export function bookableDates(now = new Date(), full: Set<string> = new Set()): DateState[] {
  const today = easternNow(now);
  const out: DateState[] = [];
  for (let i = 0; i <= SCHEDULE.bookingHorizonDays; i++) {
    const date = addDays(today.date, i);
    const wd = weekday(date);
    if (wd === 0 || wd === 6) continue;
    const isToday = i === 0;
    if (isToday && today.minutes >= SCHEDULE.sameDayCutoffMinutes) continue;
    if (SCHEDULE.closedDates.includes(date)) out.push({ date, available: false, reason: SCHEDULE.closedReasons[date] ?? "Closed", isToday });
    else if (full.has(date)) out.push({ date, available: false, reason: "Full", isToday });
    else out.push({ date, available: true, isToday });
  }
  return out;
}

export function canCancel(serviceDate: string, now = new Date()): boolean {
  const t = easternNow(now);
  return t.date < serviceDate || (t.date === serviceDate && t.minutes < SCHEDULE.cancelCutoffMinutes);
}

export const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  in_progress: "On route",
  completed: "Completed",
  missed: "Missed",
  canceled: "Canceled",
  payment_failed: "Payment failed",
  expired: "Not paid",
};
