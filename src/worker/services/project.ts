import { and, eq, isNull, ne, desc } from "drizzle-orm";
import type { Db } from "../env";
import { occurrences, taskVersions, tasks } from "../db/schema";
import { addDays, dateInTz, type ISODate } from "../../domain/dates";
import { addInterval, hasFixedSeries, type Schedule } from "../../domain/schedule";
import { initialState, pickAssignee, type AssignCtx, type AssignState, type Assignment } from "../../domain/assign";
import { generateSeries } from "../../domain/generate";
import { stateAfter, type Version } from "./materialize";

export type Projected = { taskId: string; date: ISODate; assigneeId: string; override: "away_cover" | null };

/** Assume each completion-anchored occurrence is done on its due date and keep going. */
export function projectCompletionSeries(schedule: Extract<Schedule, { type: "interval" }>, assignment: Assignment, state: AssignState, lastDate: ISODate, to: ISODate, ctx: AssignCtx, max = 400) {
  const out: { date: ISODate; assigneeId: string; override: "away_cover" | null }[] = [];
  let s = state;
  for (let d = addInterval(lastDate, schedule.n, schedule.unit), i = 0; d <= to && i < max; d = addInterval(d, schedule.n, schedule.unit), i++) {
    const p = pickAssignee(assignment, s, d, ctx);
    out.push({ date: d, assigneeId: p.assigneeId, override: p.override });
    s = p.state;
  }
  return out;
}

/** Occurrences in [from, to] that aren't stored yet (beyond the horizon), for the calendar. */
export async function projectedOccurrences(db: Db, from: ISODate, to: ISODate, ctx: AssignCtx): Promise<Projected[]> {
  const active = await db
    .select({ task: tasks, version: taskVersions })
    .from(tasks)
    .innerJoin(taskVersions, and(eq(taskVersions.taskId, tasks.id), isNull(taskVersions.effectiveTo)))
    .where(and(eq(tasks.kind, "recurring"), isNull(tasks.archivedAt)));
  const out: Projected[] = [];
  for (const { task, version } of active) {
    const schedule = version.schedule as Schedule;
    const assignment = version.assignment as Assignment;
    if (hasFixedSeries(schedule)) {
      const [last] = await db
        .select()
        .from(occurrences)
        .where(and(eq(occurrences.taskId, task.id), eq(occurrences.versionId, version.id), ne(occurrences.status, "cancelled")))
        .orderBy(desc(occurrences.scheduledDate))
        .limit(1);
      const start = last ? addDays(last.scheduledDate, 1) : version.effectiveFrom;
      if (start > to) continue;
      // Generate from the end of the stored rows so the rotation continues correctly, then keep [from, to].
      const gen = generateSeries(schedule, assignment, stateAfter(last, version), start, to, ctx).occurrences;
      for (const g of gen) if (g.date >= from) out.push({ taskId: task.id, date: g.date, assigneeId: g.assigneeId, override: g.override });
    } else if (schedule.type === "interval") {
      const [pending] = await db
        .select()
        .from(occurrences)
        .where(and(eq(occurrences.taskId, task.id), eq(occurrences.status, "pending")))
        .orderBy(desc(occurrences.scheduledDate))
        .limit(1);
      if (!pending) continue;
      const state = stateAfter(pending, version);
      // An overdue one would be done "today" at the earliest.
      const base = pending.scheduledDate;
      for (const p of projectCompletionSeries(schedule, assignment, state, base, to, ctx)) if (p.date >= from) out.push({ taskId: task.id, ...p });
    }
  }
  return out;
}

/** Next few occurrences a task would have with a new schedule/assignment (dry run of an edit). */
export function previewSeries(version: Pick<Version, "schedule" | "assignment" | "rotationStartIndex">, today: ISODate, lastCompletion: ISODate | null, ctx: AssignCtx, count = 6) {
  const schedule = version.schedule as Schedule;
  const assignment = version.assignment as Assignment;
  const state = initialState(assignment, version.rotationStartIndex);
  if (hasFixedSeries(schedule)) {
    return generateSeries(schedule, assignment, state, today, addDays(today, 800), ctx)
      .occurrences.slice(0, count)
      .map((g) => ({ date: g.date, assigneeId: g.assigneeId }));
  }
  if (schedule.type !== "interval") return [];
  const first = lastCompletion ? addInterval(lastCompletion, schedule.n, schedule.unit) : schedule.startDate;
  const p0 = pickAssignee(assignment, state, first, ctx);
  return [
    { date: first, assigneeId: p0.assigneeId },
    ...projectCompletionSeries(schedule, assignment, p0.state, first, addDays(first, 3000), ctx, count - 1).map((p) => ({ date: p.date, assigneeId: p.assigneeId })),
  ];
}

export async function lastCompletionDate(db: Db, taskId: string, tz: string): Promise<ISODate | null> {
  const [lastDone] = await db
    .select({ completedAt: occurrences.completedAt })
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, "done")))
    .orderBy(desc(occurrences.completedAt))
    .limit(1);
  return lastDone?.completedAt ? dateInTz(new Date(lastDone.completedAt), tz) : null;
}

