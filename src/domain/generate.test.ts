import { describe, expect, it } from "vitest";
import { generateSeries, nextCompletionOccurrence, daysOverdue } from "./generate";
import { initialState, type AssignCtx } from "./assign";
import type { Schedule } from "./schedule";

const members = ["A", "B", "C"];
const nobodyAway: AssignCtx = { members, isAway: () => false };
const awayCtx = (who: string, from: string, to: string): AssignCtx => ({
  members,
  isAway: (m, d) => m === who && d >= from && d <= to,
});
const tueFri: Schedule = { type: "weekdays", weekdays: [1, 4], startDate: "2026-11-16" };
const rotation = { mode: "rotation" as const, order: ["A", "B", "C"] };

const who = (r: ReturnType<typeof generateSeries>) => r.occurrences.map((o) => `${o.date}:${o.assigneeId}`);

describe("rotation", () => {
  it("advances on every occurrence: Tue A, Fri B, Tue C, Fri A", () => {
    const r = generateSeries(tueFri, rotation, initialState(rotation), "2026-11-16", "2026-11-27", nobodyAway);
    expect(who(r)).toEqual(["2026-11-17:A", "2026-11-20:B", "2026-11-24:C", "2026-11-27:A"]);
    expect(r.state.pointer).toBe(1);
  });

  it("can start from any member", () => {
    const r = generateSeries(tueFri, rotation, initialState(rotation, 2), "2026-11-16", "2026-11-20", nobodyAway);
    expect(who(r)).toEqual(["2026-11-17:C", "2026-11-20:A"]);
  });

  it("continues seamlessly when generated in chunks", () => {
    const whole = generateSeries(tueFri, rotation, initialState(rotation), "2026-11-16", "2026-12-31", nobodyAway);
    const first = generateSeries(tueFri, rotation, initialState(rotation), "2026-11-16", "2026-11-30", nobodyAway);
    const second = generateSeries(tueFri, rotation, first.state, "2026-12-01", "2026-12-31", nobodyAway);
    expect([...who(first), ...who(second)]).toEqual(who(whole));
  });

  it("with two people alternates", () => {
    const two = { mode: "rotation" as const, order: ["A", "B"] };
    const r = generateSeries(tueFri, two, initialState(two), "2026-11-16", "2026-11-27", { members: ["A", "B"], isAway: () => false });
    expect(who(r)).toEqual(["2026-11-17:A", "2026-11-20:B", "2026-11-24:A", "2026-11-27:B"]);
  });
});

describe("away mode", () => {
  it("rotation skips the away person with no make-up afterwards", () => {
    // A away 17–21 Nov: Tue 17 would be A → B takes it; Fri 20 → C; Tue 24 A is back.
    const r = generateSeries(tueFri, rotation, initialState(rotation), "2026-11-16", "2026-11-27", awayCtx("A", "2026-11-17", "2026-11-21"));
    expect(who(r)).toEqual(["2026-11-17:B", "2026-11-20:C", "2026-11-24:A", "2026-11-27:B"]);
    expect(r.occurrences[0]).toMatchObject({ generatedAssigneeId: "A", override: "away_cover" });
    expect(r.occurrences[1].override).toBeNull();
  });

  it("fixed assignee who is away is covered by the others in turn", () => {
    const fixed = { mode: "fixed" as const, memberId: "A" };
    const r = generateSeries(tueFri, fixed, initialState(fixed), "2026-11-16", "2026-11-27", awayCtx("A", "2026-11-17", "2026-11-25"));
    expect(who(r)).toEqual(["2026-11-17:B", "2026-11-20:C", "2026-11-24:B", "2026-11-27:A"]);
    expect(r.occurrences.slice(0, 3).every((o) => o.override === "away_cover")).toBe(true);
  });

  it("everyone away keeps the normal assignee and flags it", () => {
    const ctx: AssignCtx = { members, isAway: () => true };
    const r = generateSeries(tueFri, rotation, initialState(rotation), "2026-11-16", "2026-11-20", ctx);
    expect(who(r)).toEqual(["2026-11-17:A", "2026-11-20:B"]);
    expect(r.occurrences.every((o) => o.allAway)).toBe(true);
  });
});

describe("interval from last completion", () => {
  const s = { type: "interval" as const, n: 2, unit: "week" as const, anchor: "completion" as const, startDate: "2026-11-16" };

  it("first occurrence is the start date, next counts from the completion date", () => {
    const first = nextCompletionOccurrence(s, rotation, initialState(rotation), null, nobodyAway);
    expect(first).toMatchObject({ date: "2026-11-16", assigneeId: "A" });
    // Done 3 days late on the 19th → next due 3 Dec, rotation advances to B.
    const next = nextCompletionOccurrence(s, rotation, first.stateAfter, "2026-11-19", nobodyAway);
    expect(next).toMatchObject({ date: "2026-12-03", assigneeId: "B" });
  });

  it("monthly from completion clamps", () => {
    const m = { ...s, n: 3, unit: "month" as const };
    expect(nextCompletionOccurrence(m, rotation, initialState(rotation), "2026-11-30", nobodyAway).date).toBe("2027-02-28");
  });
});

describe("overdue", () => {
  it("counts days after the due date", () => {
    expect(daysOverdue("2026-11-17", "2026-11-17")).toBe(0);
    expect(daysOverdue("2026-11-17", "2026-11-19")).toBe(2);
    expect(daysOverdue("2026-11-20", "2026-11-19")).toBe(0);
  });
});
