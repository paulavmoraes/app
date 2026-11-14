import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AppEnv } from "../env";
import { members, occurrences, quickTicks, swapRequests, taskVersions, tasks } from "../db/schema";
import { dateInTz } from "../../domain/dates";
import type { Schedule } from "../../domain/schedule";
import type { Assignment } from "../../domain/assign";
import { nextCompletionOccurrence } from "../../domain/generate";
import { newId } from "../lib/tokens";
import { badRequest, conflict, notFound } from "../lib/errors";
import { loadAssignCtx } from "../services/context";
import { occurrenceRow } from "../services/materialize";

export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export const occurrenceRoutes = new Hono<AppEnv>()
  .post("/:id/complete", async (c) => {
    const db = c.var.db;
    const { doneById } = z.object({ doneById: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
    const doneBy = doneById ?? c.var.me.id;
    const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, doneBy));
    if (!m) throw badRequest("Unknown member");

    const [occ] = await db.select().from(occurrences).where(eq(occurrences.id, c.req.param("id")));
    if (!occ) throw notFound();
    if (occ.status === "missed") throw conflict("This one was missed and can't be completed any more");
    if (occ.status !== "pending") throw conflict("Already completed");

    const nowIso = c.var.now.toISOString();
    const stmts: unknown[] = [
      db.update(occurrences).set({ status: "done", completedAt: nowIso, completedById: doneBy }).where(eq(occurrences.id, occ.id)),
      db
        .update(swapRequests)
        .set({ status: "cancelled", respondedAt: nowIso })
        .where(and(eq(swapRequests.occurrenceId, occ.id), eq(swapRequests.status, "pending"))),
    ];

    // Completion-anchored tasks: the next due date counts from today's completion.
    const [version] = await db
      .select()
      .from(taskVersions)
      .where(and(eq(taskVersions.taskId, occ.taskId), isNull(taskVersions.effectiveTo)));
    const [task] = await db.select().from(tasks).where(eq(tasks.id, occ.taskId));
    const schedule = version?.schedule as Schedule | undefined;
    if (version && task && !task.archivedAt && schedule?.type === "interval" && schedule.anchor === "completion") {
      const completionDate = dateInTz(c.var.now, c.env.APP_TIMEZONE);
      const state =
        occ.versionId === version.id
          ? { pointer: occ.pointerAfter, cover: occ.coverAfter }
          : { pointer: version.rotationStartIndex, cover: 0 };
      const g = nextCompletionOccurrence(schedule, version.assignment as Assignment, state, completionDate, await loadAssignCtx(db));
      const [clash] = await db
        .select({ id: occurrences.id })
        .from(occurrences)
        .where(and(eq(occurrences.taskId, occ.taskId), eq(occurrences.scheduledDate, g.date)));
      if (!clash) stmts.push(db.insert(occurrences).values(occurrenceRow(occ.taskId, version, g, nowIso, occ.id)));
    }
    await db.batch(stmts as never);
    return c.json({ ok: true });
  })

  .post("/:id/undo", async (c) => {
    const db = c.var.db;
    const [occ] = await db.select().from(occurrences).where(eq(occurrences.id, c.req.param("id")));
    if (!occ) throw notFound();
    if (occ.status !== "done" || !occ.completedAt) throw conflict("Not completed");
    if (c.var.now.getTime() - Date.parse(occ.completedAt) > UNDO_WINDOW_MS) throw conflict("Too late to undo");
    const spawned = await db
      .select({ id: occurrences.id, status: occurrences.status })
      .from(occurrences)
      .where(eq(occurrences.spawnedById, occ.id));
    if (spawned.some((s) => s.status !== "pending")) throw conflict("The next one was already completed");
    const spawnedIds = spawned.map((s) => s.id);
    await db.batch([
      ...(spawnedIds.length
        ? [
            db.delete(swapRequests).where(inArray(swapRequests.occurrenceId, spawnedIds)),
            db.delete(occurrences).where(inArray(occurrences.id, spawnedIds)),
          ]
        : []),
      db.update(occurrences).set({ status: "pending", completedAt: null, completedById: null }).where(eq(occurrences.id, occ.id)),
    ] as never);
    return c.json({ ok: true });
  });

export const quickRoutes = new Hono<AppEnv>()
  .post("/:taskId/tick", async (c) => {
    const db = c.var.db;
    const [task] = await db.select().from(tasks).where(and(eq(tasks.id, c.req.param("taskId")), eq(tasks.kind, "quick"), isNull(tasks.archivedAt)));
    if (!task) throw notFound();
    const id = newId();
    await db.insert(quickTicks).values({ id, taskId: task.id, memberId: c.var.me.id, at: c.var.now.toISOString() });
    return c.json({ id }, 201);
  })
  .delete("/ticks/:id", async (c) => {
    const db = c.var.db;
    const [tick] = await db.select().from(quickTicks).where(eq(quickTicks.id, c.req.param("id")));
    if (!tick) throw notFound();
    if (c.var.now.getTime() - Date.parse(tick.at) > UNDO_WINDOW_MS) throw conflict("Too late to undo");
    await db.delete(quickTicks).where(eq(quickTicks.id, tick.id));
    return c.json({ ok: true });
  })
  .get("/:taskId/last", async (c) => {
    const [tick] = await c.var.db
      .select()
      .from(quickTicks)
      .where(eq(quickTicks.taskId, c.req.param("taskId")))
      .orderBy(desc(quickTicks.at))
      .limit(1);
    return c.json(tick ?? null);
  });
