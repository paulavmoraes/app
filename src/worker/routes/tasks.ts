import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { AppEnv } from "../env";
import { members, occurrences, swapRequests, taskVersions, tasks } from "../db/schema";
import { isISODate } from "../../domain/dates";
import type { TaskDTO } from "../../shared/types";
import { newId } from "../lib/tokens";
import { badRequest, notFound } from "../lib/errors";
import { materializeAll } from "../services/materialize";
import { applyNewVersion, carriedStartIndex, currentVersion } from "../services/regenerate";
import { lastCompletionDate, previewSeries } from "../services/project";
import { loadAssignCtx } from "../services/context";

const isoDate = z.string().refine(isISODate, "Invalid date");

export const scheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("weekdays"),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startDate: isoDate,
  }),
  z.object({
    type: z.literal("interval"),
    n: z.number().int().min(1).max(366),
    unit: z.enum(["day", "week", "month"]),
    anchor: z.enum(["schedule", "completion"]),
    startDate: isoDate,
  }),
]);

export const assignmentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fixed"), memberId: z.string() }),
  z.object({ mode: z.literal("rotation"), order: z.array(z.string()).min(1).max(10) }),
]);

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("quick"), name: z.string().trim().min(1).max(60) }),
  z.object({
    kind: z.literal("recurring"),
    name: z.string().trim().min(1).max(60),
    schedule: scheduleSchema,
    assignment: assignmentSchema,
  }),
]);

export async function assertMembersExist(db: AppEnv["Variables"]["db"], ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw badRequest("A person can only appear once in a rotation");
  const found = await db.select({ id: members.id }).from(members).where(inArray(members.id, unique));
  if (found.length !== unique.length) throw badRequest("Unknown member in assignment");
}

export const taskRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.var.db
      .select({ task: tasks, version: taskVersions })
      .from(tasks)
      .leftJoin(taskVersions, and(eq(taskVersions.taskId, tasks.id), isNull(taskVersions.effectiveTo)))
      .orderBy(asc(tasks.name));
    const out: TaskDTO[] = rows.map(({ task, version }) => ({
      id: task.id,
      name: task.name,
      kind: task.kind,
      archivedAt: task.archivedAt,
      schedule: (version?.schedule as TaskDTO["schedule"]) ?? null,
      assignment: (version?.assignment as TaskDTO["assignment"]) ?? null,
    }));
    return c.json(out);
  })

  .post("/", async (c) => {
    const body = createSchema.parse(await c.req.json());
    const db = c.var.db;
    const nowIso = c.var.now.toISOString();
    const taskId = newId();
    if (body.kind === "quick") {
      await db.insert(tasks).values({ id: taskId, name: body.name, kind: "quick", createdAt: nowIso });
      return c.json({ id: taskId }, 201);
    }
    await assertMembersExist(db, body.assignment.mode === "fixed" ? [body.assignment.memberId] : body.assignment.order);
    await db.batch([
      db.insert(tasks).values({ id: taskId, name: body.name, kind: "recurring", createdAt: nowIso }),
      db.insert(taskVersions).values({
        id: newId(),
        taskId,
        effectiveFrom: body.schedule.startDate,
        schedule: body.schedule,
        assignment: body.assignment,
        rotationStartIndex: 0,
        createdAt: nowIso,
      }),
    ]);
    await materializeAll(db, c.var.today, c.var.now, c.env.APP_TIMEZONE);
    return c.json({ id: taskId }, 201);
  })

  .patch("/:id", async (c) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(60).optional(), schedule: scheduleSchema.optional(), assignment: assignmentSchema.optional() })
      .parse(await c.req.json());
    const db = c.var.db;
    const id = c.req.param("id");
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!task || task.archivedAt) throw notFound();
    if (body.name) await db.update(tasks).set({ name: body.name }).where(eq(tasks.id, id));
    if (body.schedule || body.assignment) {
      if (task.kind !== "recurring") throw badRequest("Quick ticks have no schedule");
      const current = await currentVersion(db, id);
      if (!current) throw notFound();
      const schedule = body.schedule ?? (current.schedule as z.infer<typeof scheduleSchema>);
      const assignment = body.assignment ?? (current.assignment as z.infer<typeof assignmentSchema>);
      await assertMembersExist(db, assignment.mode === "fixed" ? [assignment.memberId] : assignment.order);
      await applyNewVersion(db, id, { schedule, assignment }, c.var.today, c.var.now, c.env.APP_TIMEZONE);
    }
    return c.json({ ok: true });
  })

  .post("/:id/preview", async (c) => {
    const body = z.object({ schedule: scheduleSchema, assignment: assignmentSchema }).parse(await c.req.json());
    const db = c.var.db;
    const id = c.req.param("id");
    const current = await currentVersion(db, id);
    if (!current) throw notFound();
    const rotationStartIndex = await carriedStartIndex(db, id, current, body.assignment, c.var.today);
    const preview = previewSeries(
      { ...body, rotationStartIndex },
      c.var.today,
      await lastCompletionDate(db, id, c.env.APP_TIMEZONE),
      await loadAssignCtx(db),
      12,
    );
    // Dates already done or missed stay as they are, so don't show them as upcoming.
    const closed = new Set(
      (
        await db
          .select({ date: occurrences.scheduledDate })
          .from(occurrences)
          .where(and(eq(occurrences.taskId, id), gte(occurrences.scheduledDate, c.var.today), inArray(occurrences.status, ["done", "missed"])))
      ).map((r) => r.date),
    );
    return c.json(preview.filter((p) => !closed.has(p.date)).slice(0, 6));
  })

  .post("/:id/archive", async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!task) throw notFound();
    const nowIso = c.var.now.toISOString();
    const pending = await db
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(eq(occurrences.taskId, id), eq(occurrences.status, "pending")));
    const pendingIds = pending.map((p) => p.id);
    await db.batch([
      db.update(tasks).set({ archivedAt: nowIso }).where(eq(tasks.id, id)),
      db.update(taskVersions).set({ effectiveTo: c.var.today }).where(and(eq(taskVersions.taskId, id), isNull(taskVersions.effectiveTo))),
      // Pending occurrences (future and overdue) are cancelled; done/missed history stays.
      db.update(occurrences).set({ status: "cancelled" }).where(and(eq(occurrences.taskId, id), eq(occurrences.status, "pending"))),
      ...(pendingIds.length
        ? [db.update(swapRequests).set({ status: "cancelled", respondedAt: nowIso }).where(and(inArray(swapRequests.occurrenceId, pendingIds), eq(swapRequests.status, "pending")))]
        : []),
    ] as never);
    return c.json({ ok: true });
  });
