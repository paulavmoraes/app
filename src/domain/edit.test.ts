import { describe, expect, it } from "vitest";
import { carryPointer, planRegeneration, type ExistingRow } from "./edit";
import { generateSeries } from "./generate";
import { initialState, type AssignCtx } from "./assign";
import type { Schedule } from "./schedule";

const ctx: AssignCtx = { members: ["A", "B", "C"], isAway: () => false };
const rot = (...order: string[]) => ({ mode: "rotation" as const, order });

describe("carryPointer", () => {
  it("keeps whoever was next up", () => {
    // Old A,B,C with pointer at C (2) → new order C,A,B → C is index 0.
    expect(carryPointer(rot("A", "B", "C"), 2, rot("C", "A", "B"))).toBe(0);
  });
  it("skips to the next old member still in the rotation", () => {
    // Next up was B, who was removed → C is next.
    expect(carryPointer(rot("A", "B", "C"), 1, rot("A", "C"))).toBe(1);
  });
  it("starts from the top when changing from fixed or to a new set", () => {
    expect(carryPointer({ mode: "fixed", memberId: "A" }, 0, rot("B", "C"))).toBe(0);
    expect(carryPointer(rot("A"), 0, rot("B", "C"))).toBe(0);
    expect(carryPointer(rot("A", "B"), 1, { mode: "fixed", memberId: "C" })).toBe(0);
  });
});

describe("planRegeneration: edits only affect the future", () => {
  // Old: Tue/Fri rotation A,B. New from Mon 23 Nov: Wed only, rotation A,B,C continuing.
  const newSchedule: Schedule = { type: "weekdays", weekdays: [2], startDate: "2026-11-23" };
  const gen = generateSeries(newSchedule, rot("A", "B", "C"), initialState(rot("A", "B", "C"), 1), "2026-11-23", "2026-12-06", ctx).occurrences;

  it("generates the expected new series", () => {
    expect(gen.map((g) => `${g.date}:${g.assigneeId}`)).toEqual(["2026-11-25:B", "2026-12-02:C"]);
  });

  it("cancels dropped dates, inserts new ones and leaves done rows alone", () => {
    const existing: ExistingRow[] = [
      { id: "tue24", date: "2026-11-24", status: "pending", assigneeId: "A", override: null },
      { id: "fri27", date: "2026-11-27", status: "pending", assigneeId: "B", override: "swap" },
      { id: "wed02", date: "2026-12-02", status: "done", assigneeId: "A", override: null }, // completed early
    ];
    const plan = planRegeneration(existing, gen);
    expect(plan.insert.map((g) => g.date)).toEqual(["2026-11-25"]);
    expect(plan.update).toEqual([]);
    expect(plan.cancel).toEqual([
      { id: "tue24", override: null },
      { id: "fri27", override: "swap" },
    ]);
    expect(plan.cancelSwapsFor).toEqual(["tue24", "fri27"]);
  });

  it("reuses rows on the same date; swap/penalty overrides survive, away cover is recomputed", () => {
    const existing: ExistingRow[] = [
      { id: "w25", date: "2026-11-25", status: "pending", assigneeId: "C", override: "swap" },
      { id: "w02", date: "2026-12-02", status: "pending", assigneeId: "A", override: "away_cover" },
    ];
    const plan = planRegeneration(existing, gen);
    expect(plan.update).toEqual([
      { id: "w25", gen: gen[0], keepAssignee: true },
      { id: "w02", gen: gen[1], keepAssignee: false },
    ]);
    // w02's assignee changes A → C, so any pending swap on it is void.
    expect(plan.cancelSwapsFor).toEqual(["w02"]);
    expect(plan.insert).toEqual([]);
  });

  it("revives a previously cancelled row when its date comes back", () => {
    const existing: ExistingRow[] = [{ id: "old", date: "2026-11-25", status: "cancelled", assigneeId: "A", override: null }];
    const plan = planRegeneration(existing, gen);
    expect(plan.update[0]).toMatchObject({ id: "old", keepAssignee: false });
    expect(plan.cancelSwapsFor).toEqual([]);
  });
});
