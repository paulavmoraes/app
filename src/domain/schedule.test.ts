import { describe, expect, it } from "vitest";
import { firstScheduledOnOrAfter, scheduledDates, type Schedule } from "./schedule";

describe("weekday schedules", () => {
  const tueFri: Schedule = { type: "weekdays", weekdays: [1, 4], startDate: "2026-11-16" };

  it("lists Tuesdays and Fridays from the start date", () => {
    expect(scheduledDates(tueFri, "2026-11-01", "2026-11-30")).toEqual([
      "2026-11-17",
      "2026-11-20",
      "2026-11-24",
      "2026-11-27",
    ]);
  });

  it("is unaffected by DST changes", () => {
    const sundays: Schedule = { type: "weekdays", weekdays: [6], startDate: "2026-03-01" };
    expect(scheduledDates(sundays, "2026-03-20", "2026-04-06")).toEqual(["2026-03-22", "2026-03-29", "2026-04-05"]);
  });

  it("returns nothing for an empty weekday set", () => {
    expect(scheduledDates({ ...tueFri, weekdays: [] }, "2026-11-01", "2026-12-01")).toEqual([]);
  });
});

describe("interval schedules from the scheduled date", () => {
  it("every 2 weeks, anchored to the start", () => {
    const s: Schedule = { type: "interval", n: 2, unit: "week", anchor: "schedule", startDate: "2026-11-03" };
    expect(scheduledDates(s, "2026-11-10", "2026-12-31")).toEqual(["2026-11-17", "2026-12-01", "2026-12-15", "2026-12-29"]);
  });

  it("every 3 days", () => {
    const s: Schedule = { type: "interval", n: 3, unit: "day", anchor: "schedule", startDate: "2026-11-14" };
    expect(scheduledDates(s, "2026-11-14", "2026-11-23")).toEqual(["2026-11-14", "2026-11-17", "2026-11-20", "2026-11-23"]);
  });

  it("every 3 months from the 31st clamps without drifting", () => {
    const s: Schedule = { type: "interval", n: 1, unit: "month", anchor: "schedule", startDate: "2026-01-31" };
    expect(scheduledDates(s, "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    const q: Schedule = { type: "interval", n: 3, unit: "month", anchor: "schedule", startDate: "2026-11-30" };
    expect(scheduledDates(q, "2026-11-01", "2027-12-31")).toEqual(["2026-11-30", "2027-02-28", "2027-05-30", "2027-08-30", "2027-11-30"]);
  });

  it("finds the first date on or after a day", () => {
    const s: Schedule = { type: "interval", n: 2, unit: "week", anchor: "schedule", startDate: "2026-11-03" };
    expect(firstScheduledOnOrAfter(s, "2026-11-18")).toBe("2026-12-01");
  });

  it("rejects completion-anchored schedules", () => {
    const s: Schedule = { type: "interval", n: 2, unit: "week", anchor: "completion", startDate: "2026-11-03" };
    expect(() => scheduledDates(s, "2026-11-01", "2026-12-01")).toThrow();
  });
});
