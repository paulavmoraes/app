import type { Schedule } from "../domain/schedule";
import type { Assignment } from "../domain/assign";
import type { Member } from "../shared/types";
import { WEEKDAYS } from "./format";

export function describeSchedule(s: Schedule): string {
  if (s.type === "weekdays") {
    if (s.weekdays.length === 7) return "Every day";
    return `Every ${[...s.weekdays].sort().map((d) => WEEKDAYS[d]).join(", ")}`;
  }
  const unit = s.n === 1 ? s.unit : `${s.n} ${s.unit}s`;
  return `Every ${unit}${s.anchor === "completion" ? ", from last completion" : ""}`;
}

export function describeAssignment(a: Assignment, members: Map<string, Member>): string {
  const name = (id: string) => members.get(id)?.displayName ?? "?";
  return a.mode === "fixed" ? name(a.memberId) : `Rotation: ${a.order.map(name).join(" → ")}`;
}
