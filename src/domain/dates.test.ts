import { describe, expect, it } from "vitest";
import { addDays, addMonthsClamped, dateInTz, diffDays, hourInTz, isISODate, weekdayOf } from "./dates";

describe("dates", () => {
  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // UK clocks go forward 29 Mar
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26"); // clocks go back 25 Oct
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("diffs days", () => {
    expect(diffDays("2026-11-20", "2026-11-14")).toBe(6);
    expect(diffDays("2026-03-30", "2026-03-28")).toBe(2);
  });

  it("weekday is Monday-based", () => {
    expect(weekdayOf("2026-11-16")).toBe(0); // Monday
    expect(weekdayOf("2026-11-15")).toBe(6); // Sunday
  });

  it("clamps months", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("computes the London date and hour around midnight UTC", () => {
    expect(dateInTz(new Date("2026-07-01T23:30:00Z"), "Europe/London")).toBe("2026-07-02"); // BST
    expect(dateInTz(new Date("2026-01-01T23:30:00Z"), "Europe/London")).toBe("2026-01-01"); // GMT
    expect(hourInTz(new Date("2026-07-01T08:00:00Z"), "Europe/London")).toBe(9);
    expect(hourInTz(new Date("2026-01-15T09:00:00Z"), "Europe/London")).toBe(9);
  });

  it("validates ISO dates", () => {
    expect(isISODate("2026-02-28")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("26-2-1")).toBe(false);
  });
});
