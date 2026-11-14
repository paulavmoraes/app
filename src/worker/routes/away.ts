import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, gte, isNull } from "drizzle-orm";
import type { AppEnv, Db } from "../env";
import { awayPeriods, taskVersions, tasks } from "../db/schema";
import { diffDays, isISODate, type ISODate } from "../../domain/dates";
import type { AwayDTO } from "../../shared/types";
import { newId } from "../lib/tokens";
import { badRequest, conflict, notFound } from "../lib/errors";
import { regenerateFuture } from "../services/regenerate";
import { runMaintenance } from "../services/rules";

/** Away periods changed: re-plan every task from today, then re-apply any penalty shifts that were released. */
async function replanAll(db: Db, today: ISODate, now: Date, tz: string) {
  const active = await db
    .select({ version: taskVersions })
    .from(tasks)
    .innerJoin(taskVersions, and(eq(taskVersions.taskId, tasks.id), isNull(taskVersions.effectiveTo)))
    .where(and(eq(tasks.kind, "recurring"), isNull(tasks.archivedAt)));
  for (const { version } of active) await regenerateFuture(db, version.taskId, version, today, now, tz);
  await runMaintenance(db, today, now, tz);
}

export const awayRoutes = new Hono<AppEnv>()
  // Current and upcoming away periods of everyone.
  .get("/", async (c) => {
    const rows = await c.var.db.select().from(awayPeriods).where(gte(awayPeriods.endDate, c.var.today)).orderBy(asc(awayPeriods.startDate));
    const body: AwayDTO[] = rows.map(({ id, memberId, startDate, endDate }) => ({ id, memberId, startDate, endDate }));
    return c.json(body);
  })

  .post("/", async (c) => {
    const { db, me, today, now } = c.var;
    const body = z.object({ startDate: z.string().refine(isISODate), endDate: z.string().refine(isISODate) }).parse(await c.req.json());
    if (body.endDate < body.startDate) throw badRequest("The end date is before the start date");
    if (body.endDate < today) throw badRequest("That period is already over");
    if (diffDays(body.endDate, body.startDate) > 366) throw badRequest("Away periods can be at most a year");
    const mine = await db.select().from(awayPeriods).where(eq(awayPeriods.memberId, me.id));
    if (mine.some((p) => p.startDate <= body.endDate && body.startDate <= p.endDate)) throw conflict("This overlaps another away period of yours");
    const id = newId();
    await db.insert(awayPeriods).values({ id, memberId: me.id, ...body, createdAt: now.toISOString() });
    await replanAll(db, today, now, c.env.APP_TIMEZONE);
    return c.json({ id }, 201);
  })

  .delete("/:id", async (c) => {
    const { db, me, today, now } = c.var;
    const [p] = await db.select().from(awayPeriods).where(and(eq(awayPeriods.id, c.req.param("id")), eq(awayPeriods.memberId, me.id)));
    if (!p) throw notFound();
    await db.delete(awayPeriods).where(eq(awayPeriods.id, p.id));
    await replanAll(db, today, now, c.env.APP_TIMEZONE);
    return c.json({ ok: true });
  });
