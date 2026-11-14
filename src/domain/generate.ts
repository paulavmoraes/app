import { diffDays, type ISODate } from "./dates";
import { addInterval, scheduledDates, type Schedule } from "./schedule";
import { pickAssignee, type AssignCtx, type AssignState, type Assignment, type Pick } from "./assign";

export type GeneratedOccurrence = Omit<Pick, "state"> & { date: ISODate; stateAfter: AssignState };

/** Occurrences of a fixed-series task in [from, to], continuing from `state`. Deterministic. */
export function generateSeries(
  schedule: Schedule,
  assignment: Assignment,
  state: AssignState,
  from: ISODate,
  to: ISODate,
  ctx: AssignCtx,
): { occurrences: GeneratedOccurrence[]; state: AssignState } {
  const occurrences: GeneratedOccurrence[] = [];
  let s = state;
  for (const date of scheduledDates(schedule, from, to)) {
    const { state: next, ...pick } = pickAssignee(assignment, s, date, ctx);
    occurrences.push({ ...pick, date, stateAfter: next });
    s = next;
  }
  return { occurrences, state: s };
}

/** The single next occurrence of a completion-anchored task. `after` = completion date (or null for the first). */
export function nextCompletionOccurrence(
  schedule: Extract<Schedule, { type: "interval" }>,
  assignment: Assignment,
  state: AssignState,
  after: ISODate | null,
  ctx: AssignCtx,
): GeneratedOccurrence {
  const date = after === null ? schedule.startDate : addInterval(after, schedule.n, schedule.unit);
  const { state: next, ...pick } = pickAssignee(assignment, state, date, ctx);
  return { ...pick, date, stateAfter: next };
}

export function daysOverdue(date: ISODate, today: ISODate): number {
  return Math.max(0, diffDays(today, date));
}
