/** Calendar dates are plain `YYYY-MM-DD` strings in the household timezone. */
export type ISODate = string;

const DAY_MS = 86_400_000;

function toMs(d: ISODate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

function fromMs(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromMs(toMs(d) + n * DAY_MS);
}

/** Whole days from `b` to `a` (a - b). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toMs(a) - toMs(b)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(d: ISODate): number {
  return (new Date(toMs(d)).getUTCDay() + 6) % 7;
}

/** Adds months, clamping to the end of a shorter month (Jan 31 + 1 → Feb 28/29). */
export function addMonthsClamped(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromMs(Date.UTC(ny, nm, Math.min(day, lastDay)));
}

/** The calendar date of an instant in a timezone. */
export function dateInTz(instant: Date, tz: string): ISODate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The hour (0–23) of an instant in a timezone. */
export function hourInTz(instant: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(instant);
  return Number(h);
}

export function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromMs(toMs(s)) === s;
}
