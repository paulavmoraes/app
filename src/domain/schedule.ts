import { addDays, addMonthsClamped, diffDays, weekdayOf, type ISODate } from "./dates";

export type IntervalUnit = "day" | "week" | "month";

export type Schedule =
  | { type: "weekdays"; weekdays: number[]; startDate: ISODate }
  | {
      type: "interval";
      n: number;
      unit: IntervalUnit;
      /** "schedule": dates are start + k·n. "completion": next due = last completion + n. */
      anchor: "schedule" | "completion";
      startDate: ISODate;
    };

export function addInterval(d: ISODate, n: number, unit: IntervalUnit): ISODate {
  if (unit === "day") return addDays(d, n);
  if (unit === "week") return addDays(d, n * 7);
  return addMonthsClamped(d, n);
}

/** True when the task has a fixed series of dates (so a missed occurrence can be detected). */
export function hasFixedSeries(s: Schedule): boolean {
  return s.type === "weekdays" || s.anchor === "schedule";
}

/**
 * All scheduled dates in [from, to] (inclusive) for schedules with a fixed series.
 * Interval dates are always computed from the anchor (start + k·n), never cumulatively.
 */
export function scheduledDates(s: Schedule, from: ISODate, to: ISODate): ISODate[] {
  if (!hasFixedSeries(s)) throw new Error("completion-anchored schedules have no fixed series");
  const out: ISODate[] = [];
  const start = from > s.startDate ? from : s.startDate;
  if (start > to) return out;

  if (s.type === "weekdays") {
    const set = new Set(s.weekdays);
    if (set.size === 0) return out;
    for (let d = start; d <= to; d = addDays(d, 1)) if (set.has(weekdayOf(d))) out.push(d);
    return out;
  }

  if (s.n < 1) throw new Error("interval must be at least 1");
  if (s.unit === "month") {
    for (let k = 0; ; k++) {
      const d = addMonthsClamped(s.startDate, k * s.n);
      if (d > to) break;
      if (d >= from) out.push(d);
    }
    return out;
  }

  const step = s.n * (s.unit === "week" ? 7 : 1);
  let k = Math.max(0, Math.ceil(diffDays(from, s.startDate) / step));
  for (let d = addDays(s.startDate, k * step); d <= to; d = addDays(s.startDate, ++k * step)) out.push(d);
  return out;
}

/** The first date of the series on or after `from`, or null if none within ~2 years. */
export function firstScheduledOnOrAfter(s: Schedule, from: ISODate): ISODate | null {
  return scheduledDates(s, from, addDays(from, 800))[0] ?? null;
}
