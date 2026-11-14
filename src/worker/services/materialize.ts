import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../env";
import { occurrences, taskVersions, tasks } from "../db/schema";
import { addDays, type ISODate } from "../../domain/dates";
import { hasFixedSeries, type Schedule } from "../../domain/schedule";
import { initialState, type AssignCtx, type AssignState, type Assignment } from "../../domain/assign";
import { generateSeries, nextCompletionOccurrence, type GeneratedOccurrence } from "../../domain/generate";
import { newId } from "../lib/tokens";
import { loadAssignCtx } from "./context";

/** Occurrences are stored up to this many days ahead; later dates are projected on the fly. */
export const HORIZON_DAYS = 90;

type Version = typeof taskVersions.$inferSelect;

export function occurrenceRow(taskId: string, version: Version, g: GeneratedOccurrence, nowIso: string, spawnedById?: string) {
  return {
    id: newId(),
    taskId,
    versionId: version.id,
    scheduledDate: g.date,
    status: "pending" as const,
    generatedAssigneeId: g.generatedAssigneeId,
    assigneeId: g.assigneeId,
    override: g.override,
    allAway: g.allAway,
    pointerAfter: g.stateAfter.pointer,
    coverAfter: g.stateAfter.cover,
    spawnedById: spawnedById ?? null,
    createdAt: nowIso,
  };
}

/** Rotation state to continue from: the last occurrence of this version, or the version's initial state. */
export function stateAfter(last: { versionId: string; pointerAfter: number; coverAfter: number } | undefined, version: Version): AssignState {
  if (last && last.versionId === version.id) return { pointer: last.pointerAfter, cover: last.coverAfter };
  return initialState(version.assignment as Assignment, version.rotationStartIndex);
}

/** Make sure every active recurring task has its occurrences stored up to the horizon. Idempotent. */
export async function materializeAll(db: Db, today: ISODate, now: Date, ctx?: AssignCtx): Promise<void> {
  const active = await db
    .select({ task: tasks, version: taskVersions })
    .from(tasks)
    .innerJoin(taskVersions, and(eq(taskVersions.taskId, tasks.id), isNull(taskVersions.effectiveTo)))
    .where(and(eq(tasks.kind, "recurring"), isNull(tasks.archivedAt)));
  if (active.length === 0) return;
  const assignCtx = ctx ?? (await loadAssignCtx(db));
  for (const { task, version } of active) await materializeTask(db, task.id, version, today, now, assignCtx);
}

export async function materializeTask(db: Db, taskId: string, version: Version, today: ISODate, now: Date, ctx: AssignCtx) {
  const schedule = version.schedule as Schedule;
  const assignment = version.assignment as Assignment;
  const [last] = await db
    .select()
    .from(occurrences)
    .where(eq(occurrences.taskId, taskId))
    .orderBy(desc(occurrences.scheduledDate))
    .limit(1);
  const nowIso = now.toISOString();
  const horizon = addDays(today, HORIZON_DAYS);

  if (hasFixedSeries(schedule)) {
    let from = version.effectiveFrom;
    if (last && last.scheduledDate >= from) from = addDays(last.scheduledDate, 1);
    if (from > horizon) return;
    const { occurrences: gen } = generateSeries(schedule, assignment, stateAfter(last, version), from, horizon, ctx);
    if (gen.length) await db.batch(gen.map((g) => db.insert(occurrences).values(occurrenceRow(taskId, version, g, nowIso))) as never);
    return;
  }

  // Completion-anchored: only ever one pending occurrence. Create the first one if this version has none.
  const [anyForVersion] = await db
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), eq(occurrences.versionId, version.id)))
    .limit(1);
  if (anyForVersion) return;
  if (schedule.type !== "interval") return;
  const g = nextCompletionOccurrence({ ...schedule, startDate: schedule.startDate }, assignment, stateAfter(last, version), null, ctx);
  await db.insert(occurrences).values(occurrenceRow(taskId, version, g, nowIso));
}
