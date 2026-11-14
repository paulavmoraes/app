import { and, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "../env";
import { occurrences, taskVersions } from "../db/schema";
import type { ISODate } from "../../domain/dates";
import { hasFixedSeries, type Schedule } from "../../domain/schedule";
import type { AssignCtx, Assignment } from "../../domain/assign";
import { carryPointer } from "../../domain/edit";
import { newId } from "../lib/tokens";
import { loadAssignCtx } from "./context";
import { ensureNextCompletionOccurrence, lastLiveOccurrence, reconcileSeries, stateAfter, type Version } from "./materialize";


/** Rotation pointer to start a new version with, so whoever was next up stays next up. */
export async function carriedStartIndex(db: Db, taskId: string, current: Version, newAssignment: Assignment, today: ISODate) {
  const lastBefore = await lastLiveOccurrence(db, taskId, { before: today });
  if (lastBefore) {
    const [v] = await db.select().from(taskVersions).where(eq(taskVersions.id, lastBefore.versionId));
    return carryPointer(v.assignment as Assignment, lastBefore.pointerAfter, newAssignment);
  }
  return carryPointer(current.assignment as Assignment, current.rotationStartIndex, newAssignment);
}

export async function currentVersion(db: Db, taskId: string) {
  const [v] = await db
    .select()
    .from(taskVersions)
    .where(and(eq(taskVersions.taskId, taskId), isNull(taskVersions.effectiveTo)));
  return v as Version | undefined;
}

/** Close the current version and open a new one from today, then re-plan occurrences dated today or later. */
export async function applyNewVersion(db: Db, taskId: string, next: { schedule: Schedule; assignment: Assignment }, today: ISODate, now: Date, tz: string) {
  const current = await currentVersion(db, taskId);
  if (!current) throw new Error("task has no current version");
  const version: Version = {
    id: newId(),
    taskId,
    effectiveFrom: today,
    effectiveTo: null,
    schedule: next.schedule,
    assignment: next.assignment,
    rotationStartIndex: await carriedStartIndex(db, taskId, current, next.assignment, today),
    createdAt: now.toISOString(),
  };
  await db.batch([
    db.update(taskVersions).set({ effectiveTo: today }).where(eq(taskVersions.id, current.id)),
    db.insert(taskVersions).values(version),
  ]);
  await regenerateFuture(db, taskId, version, today, now, tz);
}

/** Re-plan stored occurrences dated today or later with `version`. Past and overdue rows are never touched. */
export async function regenerateFuture(db: Db, taskId: string, version: Version, today: ISODate, now: Date, tz: string, ctx?: AssignCtx) {
  const assignCtx = ctx ?? (await loadAssignCtx(db));
  if (hasFixedSeries(version.schedule as Schedule)) {
    const lastBefore = await lastLiveOccurrence(db, taskId, { before: today });
    await reconcileSeries(db, taskId, version, today, stateAfter(lastBefore, version), today, now, assignCtx);
    return;
  }
  // Completion-anchored: drop future pending rows (overdue ones stay), then ensure the single next one.
  await db
    .update(occurrences)
    .set({ status: "cancelled" })
    .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, "pending"), gte(occurrences.scheduledDate, today)));
  await ensureNextCompletionOccurrence(db, taskId, version, now, assignCtx, tz);
}
