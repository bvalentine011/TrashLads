import { SCHEDULE } from "./config";

/** Date and minutes-after-midnight in the service time zone (Eastern). */
export function easternNow(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type ServiceDateProblem =
  | "invalid"
  | "past"
  | "weekend"
  | "closed"
  | "too-far"
  | "same-day-closed";

/** Returns why a date can't be booked right now, or null if it can. */
export function serviceDateProblem(serviceDate: unknown, now: Date): ServiceDateProblem | null {
  if (!isIsoDate(serviceDate)) return "invalid";
  const today = easternNow(now);
  if (serviceDate < today.date) return "past";
  if (!(SCHEDULE.serviceWeekdays as readonly number[]).includes(weekdayOf(serviceDate))) return "weekend";
  if ((SCHEDULE.closedDates as readonly string[]).includes(serviceDate)) return "closed";
  if (serviceDate > addDays(today.date, SCHEDULE.bookingHorizonDays)) return "too-far";
  if (serviceDate === today.date && today.minutes >= SCHEDULE.sameDayCutoffMinutes) return "same-day-closed";
  return null;
}

/** True while a resident can still cancel for an automatic full refund. */
export function isBeforeCancelCutoff(serviceDate: string, now: Date): boolean {
  const today = easternNow(now);
  if (today.date < serviceDate) return true;
  if (today.date > serviceDate) return false;
  return today.minutes < SCHEDULE.customerCancelCutoffMinutes;
}
