import type { ISODate } from "./dates";
import type { Assignment } from "./assign";
import type { GeneratedOccurrence } from "./generate";

/**
 * Where a rotation continues after an edit: whoever was "next up" under the old
 * assignment stays next up in the new order (if they're still in it).
 */
export function carryPointer(oldAssignment: Assignment, oldPointer: number, newAssignment: Assignment): number {
  if (newAssignment.mode !== "rotation") return 0;
  if (oldAssignment.mode !== "rotation" || oldAssignment.order.length === 0) return 0;
  const old = oldAssignment.order;
  for (let i = 0; i < old.length; i++) {
    const candidate = old[(oldPointer + i) % old.length];
    const idx = newAssignment.order.indexOf(candidate);
    if (idx >= 0) return idx;
  }
  return 0;
}

export type ExistingRow = {
  id: string;
  date: ISODate;
  status: "pending" | "done" | "missed" | "cancelled";
  assigneeId: string;
  override: "swap" | "penalty" | "away_cover" | null;
};

export type RegenerationPlan = {
  /** Reuse an existing row for a regenerated date. keepAssignee: a swap/penalty override survives the edit. */
  update: { id: string; gen: GeneratedOccurrence; keepAssignee: boolean }[];
  insert: GeneratedOccurrence[];
  /** Pending rows whose date no longer exists in the new schedule → cancelled. */
  cancel: { id: string; override: ExistingRow["override"] }[];
  /** Pending swap proposals on these occurrences must be cancelled (row removed or assignee changed). */
  cancelSwapsFor: string[];
  /** Occurrences that stop being someone's penalty shift (cancelled or reassigned) → the penalty is owed again. */
  releasePenalties: string[];
};

/**
 * Reconcile stored occurrences dated today or later with a freshly generated series.
 * Done/missed rows are never touched (their dates are skipped). Overdue rows (before today)
 * must not be passed in at all.
 */
export function planRegeneration(
  existing: ExistingRow[],
  generated: GeneratedOccurrence[],
  isAway: (memberId: string, date: ISODate) => boolean = () => false,
): RegenerationPlan {
  const byDate = new Map(existing.map((e) => [e.date, e]));
  const generatedDates = new Set(generated.map((g) => g.date));
  const plan: RegenerationPlan = { update: [], insert: [], cancel: [], cancelSwapsFor: [], releasePenalties: [] };

  for (const g of generated) {
    const e = byDate.get(g.date);
    if (!e) {
      plan.insert.push(g);
      continue;
    }
    if (e.status === "done" || e.status === "missed") continue;
    // A swap or penalty shift survives, unless that person is now away on the day.
    const keepAssignee = e.status === "pending" && (e.override === "swap" || e.override === "penalty") && !isAway(e.assigneeId, e.date);
    plan.update.push({ id: e.id, gen: g, keepAssignee });
    if (e.status === "pending" && !keepAssignee && e.override === "penalty") plan.releasePenalties.push(e.id);
    if (e.status === "pending" && !keepAssignee && e.assigneeId !== g.assigneeId) plan.cancelSwapsFor.push(e.id);
  }

  for (const e of existing) {
    if (e.status === "pending" && !generatedDates.has(e.date)) {
      plan.cancel.push({ id: e.id, override: e.override });
      plan.cancelSwapsFor.push(e.id);
      if (e.override === "penalty") plan.releasePenalties.push(e.id);
    }
  }
  return plan;
}
