import { and, desc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import type { Db } from "../env";
import { occurrences, penalties, swapRequests, taskVersions, tasks } from "../db/schema";
import { addDays, dateInTz, type ISODate } from "../../domain/dates";
import { hasFixedSeries, type Schedule } from "../../domain/schedule";
import { initialState, type AssignCtx, type AssignState, type Assignment } from "../../domain/assign";
import { generateSeries, nextCompletionOccurrence, type GeneratedOccurrence } from "../../domain/generate";
import { planRegeneration } from "../../domain/edit";
import { newId } from "../lib/tokens";
import { loadAssignCtx } from "./context";

/** Occurrences are stored up to this many days ahead; later dates are projected on the fly. */
export const HORIZON_DAYS = 90;

export type Version = typeof taskVersions.$inferSelect;
type OccRow = typeof occurrences.$inferSelect;

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

/** Rotation state to continue from: a row of this version, or the version's initial state. */
export function stateAfter(last: Pick<OccRow, "versionId" | "pointerAfter" | "coverAfter"> | undefined, version: Version): AssignState {
  if (last && last.versionId === version.id) return { pointer: last.pointerAfter, cover: last.coverAfter };
  return initialState(version.assignment as Assignment, version.rotationStartIndex);
}

/** The latest non-cancelled occurrence of a task, optionally before a date. */
export async function lastLiveOccurrence(db: Db, taskId: string, opts: { versionId?: string; before?: ISODate } = {}) {
  const conds = [eq(occurrences.taskId, taskId), ne(occurrences.status, "cancelled")];
  if (opts.versionId) conds.push(eq(occurrences.versionId, opts.versionId));
  if (opts.before) conds.push(lt(occurrences.scheduledDate, opts.before));
  const [row] = await db.select().from(occurrences).where(and(...conds)).orderBy(desc(occurrences.scheduledDate)).limit(1);
  return row as OccRow | undefined;
}



/**
 * Generate a fixed series from `from` to the horizon with `state`, and reconcile it with the stored rows
 * dated `from` or later: rows on the same date are reused, swap/penalty overrides survive, pending rows on
 * dates that no longer exist are cancelled, done/missed rows are left alone.
 */
export async function reconcileSeries(db: Db, taskId: string, version: Version, from: ISODate, state: AssignState, today: ISODate, now: Date, ctx: AssignCtx) {
  const horizon = addDays(today, HORIZON_DAYS);
  if (from > horizon) return;
  const generated = generateSeries(version.schedule as Schedule, version.assignment as Assignment, state, from, horizon, ctx).occurrences;
  const existing = await db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), gte(occurrences.scheduledDate, from)));
  const plan = planRegeneration(
    existing.map((e) => ({ id: e.id, date: e.scheduledDate, status: e.status, assigneeId: e.assigneeId, override: e.override })),
    generated,
    ctx.isAway,
  );
  const nowIso = now.toISOString();
  const prev = new Map(existing.map((e) => [e.id, e]));
  const stmts: unknown[] = [];

  for (const u of plan.update) {
    const row = occurrenceRow(taskId, version, u.gen, nowIso);
    const old = prev.get(u.id)!;
    stmts.push(
      db
        .update(occurrences)
        .set({
          versionId: version.id,
          status: "pending",
          generatedAssigneeId: row.generatedAssigneeId,
          assigneeId: u.keepAssignee ? old.assigneeId : row.assigneeId,
          override: u.keepAssignee ? old.override : row.override,
          allAway: row.allAway,
          pointerAfter: row.pointerAfter,
          coverAfter: row.coverAfter,
          penaltyForOccurrenceId: u.keepAssignee ? old.penaltyForOccurrenceId : null,
        })
        .where(eq(occurrences.id, u.id)),
    );
  }
  for (const g of plan.insert) stmts.push(db.insert(occurrences).values(occurrenceRow(taskId, version, g, nowIso)));
  if (plan.cancel.length) {
    stmts.push(db.update(occurrences).set({ status: "cancelled" }).where(inArray(occurrences.id, plan.cancel.map((c) => c.id))));
  }
  // A penalty shift that disappears or is reassigned goes back to being owed.
  if (plan.releasePenalties.length) {
    stmts.push(db.update(penalties).set({ status: "owed", appliedOccurrenceId: null }).where(inArray(penalties.appliedOccurrenceId, plan.releasePenalties)));
  }
  if (plan.cancelSwapsFor.length) {
    stmts.push(
      db
        .update(swapRequests)
        .set({ status: "cancelled", respondedAt: nowIso })
        .where(and(inArray(swapRequests.occurrenceId, plan.cancelSwapsFor), eq(swapRequests.status, "pending"))),
    );
  }
  if (stmts.length) await db.batch(stmts as never);
}

/** Make sure every active recurring task has its occurrences stored up to the horizon. Idempotent. */
export async function materializeAll(db: Db, today: ISODate, now: Date, tz: string, ctx?: AssignCtx): Promise<void> {
  const active = await db
    .select({ task: tasks, version: taskVersions })
    .from(tasks)
    .innerJoin(taskVersions, and(eq(taskVersions.taskId, tasks.id), isNull(taskVersions.effectiveTo)))
    .where(and(eq(tasks.kind, "recurring"), isNull(tasks.archivedAt)));
  if (active.length === 0) return;
  const assignCtx = ctx ?? (await loadAssignCtx(db));
  for (const { task, version } of active) await materializeTask(db, task.id, version, today, now, assignCtx, tz);
}

export async function materializeTask(db: Db, taskId: string, version: Version, today: ISODate, now: Date, ctx: AssignCtx, tz: string) {
  const schedule = version.schedule as Schedule;
  if (!hasFixedSeries(schedule)) return ensureNextCompletionOccurrence(db, taskId, version, now, ctx, tz);
  const last = await lastLiveOccurrence(db, taskId, { versionId: version.id });
  const from = last ? addDays(last.scheduledDate, 1) : version.effectiveFrom;
  if (from > addDays(today, HORIZON_DAYS)) return;
  await reconcileSeries(db, taskId, version, from, stateAfter(last, version), today, now, ctx);
}

/**
 * Completion-anchored tasks always have exactly one pending occurrence. If there is none, create it:
 * one interval after the latest completion, or on the start date if never done.
 */
export async function ensureNextCompletionOccurrence(db: Db, taskId: string, version: Version, now: Date, ctx: AssignCtx, tz: string, spawnedById?: string) {
  const schedule = version.schedule as Schedule;
  if (schedule.type !== "interval" || schedule.anchor !== "completion") return;
  const [pending] = await db
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, "pending")))
    .limit(1);
  if (pending) return;
  const [lastDone] = await db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), eq(occurrences.status, "done")))
    .orderBy(desc(occurrences.completedAt))
    .limit(1);
  const last = await lastLiveOccurrence(db, taskId, { versionId: version.id });
  const after = lastDone?.completedAt ? dateInTz(new Date(lastDone.completedAt), tz) : null;
  const g = nextCompletionOccurrence(schedule, version.assignment as Assignment, stateAfter(last, version), after, ctx);
  const nowIso = now.toISOString();
  const [clash] = await db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.taskId, taskId), eq(occurrences.scheduledDate, g.date)));
  if (!clash) {
    await db.insert(occurrences).values(occurrenceRow(taskId, version, g, nowIso, spawnedById));
  } else if (clash.status === "cancelled") {
    const { id: _ignored, ...row } = occurrenceRow(taskId, version, g, nowIso, spawnedById);
    await db.update(occurrences).set(row).where(eq(occurrences.id, clash.id));
  }
}
