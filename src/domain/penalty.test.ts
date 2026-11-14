import { describe, expect, it } from "vitest";
import { assignPenalties, findMissed, penaltyApplies, type Candidate, type SeriesRow } from "./penalty";

const never = () => false;
// Tue/Fri task: Tue 17 (A), Fri 20 (B), Tue 24 (C)
const rows: SeriesRow[] = [
  { id: "tue17", date: "2026-11-17", status: "pending", assigneeId: "A" },
  { id: "fri20", date: "2026-11-20", status: "pending", assigneeId: "B" },
  { id: "tue24", date: "2026-11-24", status: "pending", assigneeId: "C" },
];

describe("overdue → missed", () => {
  it("is only overdue on the days before the next occurrence", () => {
    expect(findMissed(rows, "2026-11-17")).toEqual([]);
    expect(findMissed(rows, "2026-11-18")).toEqual([]);
    expect(findMissed(rows, "2026-11-19")).toEqual([]);
  });

  it("becomes missed on the day of the next occurrence", () => {
    expect(findMissed(rows, "2026-11-20")).toEqual([{ id: "tue17", assigneeId: "A", date: "2026-11-17", supersededOn: "2026-11-20" }]);
  });

  it("catches up on several at once, and ignores done ones", () => {
    expect(findMissed(rows, "2026-11-25").map((m) => m.id)).toEqual(["tue17", "fri20"]);
    const done = rows.map((r) => (r.id === "tue17" ? { ...r, status: "done" as const } : r));
    expect(findMissed(done, "2026-11-25").map((m) => m.id)).toEqual(["fri20"]);
  });

  it("counts a next occurrence that was completed early", () => {
    const early = rows.map((r) => (r.id === "fri20" ? { ...r, status: "done" as const } : r));
    expect(findMissed(early, "2026-11-20").map((m) => m.id)).toEqual(["tue17"]);
  });

  it("the last occurrence of a series is never missed", () => {
    expect(findMissed([rows[0]], "2027-01-01")).toEqual([]);
  });

  it("no penalty when away on the due date or on the day it became missed", () => {
    const m = findMissed(rows, "2026-11-20")[0];
    expect(penaltyApplies(m, never)).toBe(true);
    expect(penaltyApplies(m, (who, d) => who === "A" && d === "2026-11-17")).toBe(false);
    expect(penaltyApplies(m, (who, d) => who === "A" && d === "2026-11-20")).toBe(false);
    expect(penaltyApplies(m, (who) => who === "B")).toBe(true);
  });
});

describe("assigning the extra shift", () => {
  const cands: Candidate[] = [
    { id: "sink-thu19", taskId: "sink", date: "2026-11-19", assigneeId: "B", override: null },
    { id: "dust-fri20", taskId: "dust", date: "2026-11-20", assigneeId: "B", override: null },
    { id: "dust-tue24", taskId: "dust", date: "2026-11-24", assigneeId: "C", override: null },
    { id: "dust-fri27", taskId: "dust", date: "2026-11-27", assigneeId: "A", override: null },
  ];
  const owedA = { penaltyId: "p1", debtorId: "A", taskId: "dust" };

  it("takes the next occurrence of the same task from someone else", () => {
    expect(assignPenalties([owedA], cands, "2026-11-19", never)).toEqual([{ penaltyId: "p1", debtorId: "A", occurrenceId: "dust-fri20", freedMemberId: "B" }]);
  });

  it("falls back to the soonest occurrence of any task", () => {
    const fixedTask = { penaltyId: "p1", debtorId: "A", taskId: "bathroom" };
    expect(assignPenalties([fixedTask], cands, "2026-11-19", never)[0].occurrenceId).toBe("sink-thu19");
  });

  it("stays owed when nothing belongs to anyone else", () => {
    expect(assignPenalties([owedA], cands.filter((c) => c.assigneeId === "A"), "2026-11-19", never)).toEqual([]);
  });

  it("ignores past occurrences, other people's penalty shifts and days the debtor is away", () => {
    expect(assignPenalties([owedA], cands, "2026-11-21", never)[0].occurrenceId).toBe("dust-tue24");
    const penaltyShift = cands.map((c) => (c.id === "dust-fri20" ? { ...c, override: "penalty" as const } : c));
    expect(assignPenalties([owedA], penaltyShift, "2026-11-19", never)[0].occurrenceId).toBe("dust-tue24");
    const awayFri = (who: string, d: string) => who === "A" && d <= "2026-11-20";
    expect(assignPenalties([owedA], cands, "2026-11-19", awayFri)[0].occurrenceId).toBe("dust-tue24");
  });

  it("two owed shifts get two different occurrences", () => {
    const r = assignPenalties([owedA, { ...owedA, penaltyId: "p2" }], cands, "2026-11-19", never);
    expect(r.map((x) => x.occurrenceId)).toEqual(["dust-fri20", "dust-tue24"]);
  });
});
