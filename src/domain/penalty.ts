import type { ISODate } from "./dates";

export type SeriesRow = { id: string; date: ISODate; status: "pending" | "done" | "missed"; assigneeId: string };

export type Missed = { id: string; assigneeId: string; date: ISODate; supersededOn: ISODate };

/**
 * Rows of ONE fixed-series task (no cancelled rows). A pending occurrence is only "overdue" until
 * the next occurrence of the same task reaches its date; from that day it is missed.
 */
export function findMissed(rows: SeriesRow[], today: ISODate): Missed[] {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: Missed[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const r = sorted[i];
    const next = sorted[i + 1];
    if (r.status === "pending" && next.date <= today) out.push({ id: r.id, assigneeId: r.assigneeId, date: r.date, supersededOn: next.date });
  }
  return out;
}

/** No penalty if the person was away on the due date or on the day it became missed. */
export function penaltyApplies(m: Missed, isAway: (memberId: string, date: ISODate) => boolean): boolean {
  return !isAway(m.assigneeId, m.date) && !isAway(m.assigneeId, m.supersededOn);
}

export type Owed = { penaltyId: string; debtorId: string; taskId: string };
export type Candidate = { id: string; taskId: string; date: ISODate; assigneeId: string; override: "swap" | "penalty" | "away_cover" | null };
export type PenaltyAssignment = { penaltyId: string; debtorId: string; occurrenceId: string; freedMemberId: string };

/**
 * Give each owed extra shift a pending occurrence (dated today or later) that belongs to someone else:
 * the next one of the same task first, otherwise the soonest of any task. Penalties with no candidate stay owed.
 * Someone else's penalty shift is never taken, and nothing is assigned on a day the debtor is away.
 */
export function assignPenalties(owed: Owed[], candidates: Candidate[], today: ISODate, isAway: (memberId: string, date: ISODate) => boolean): PenaltyAssignment[] {
  const pool = candidates
    .filter((c) => c.date >= today && c.override !== "penalty")
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.taskId !== b.taskId ? (a.taskId < b.taskId ? -1 : 1) : a.id < b.id ? -1 : 1));
  const taken = new Set<string>();
  const out: PenaltyAssignment[] = [];
  for (const o of owed) {
    const eligible = pool.filter((c) => !taken.has(c.id) && c.assigneeId !== o.debtorId && !isAway(o.debtorId, c.date));
    const target = eligible.find((c) => c.taskId === o.taskId) ?? eligible[0];
    if (!target) continue;
    taken.add(target.id);
    out.push({ penaltyId: o.penaltyId, debtorId: o.debtorId, occurrenceId: target.id, freedMemberId: target.assigneeId });
  }
  return out;
}
