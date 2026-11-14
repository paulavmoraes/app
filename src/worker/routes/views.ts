import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { AppEnv } from "../env";
import { occurrences, quickTicks, tasks } from "../db/schema";
import { daysOverdue } from "../../domain/generate";
import type { HistoryDTO, HistoryItem, OccurrenceDTO, QuickTaskDTO, TodayDTO } from "../../shared/types";

export function toOccurrenceDTO(row: { occ: typeof occurrences.$inferSelect; taskName: string }, today: string): OccurrenceDTO {
  const o = row.occ;
  return {
    id: o.id,
    taskId: o.taskId,
    taskName: row.taskName,
    date: o.scheduledDate,
    status: o.status,
    assigneeId: o.assigneeId,
    override: o.override,
    daysOverdue: o.status === "pending" ? daysOverdue(o.scheduledDate, today) : 0,
    completedAt: o.completedAt,
    completedById: o.completedById,
  };
}

export async function quickTaskList(db: AppEnv["Variables"]["db"]): Promise<QuickTaskDTO[]> {
  const qs = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.kind, "quick"), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.name));
  if (!qs.length) return [];
  const latest = await db
    .select()
    .from(quickTicks)
    .where(
      and(
        inArray(quickTicks.taskId, qs.map((q) => q.id)),
        sql`${quickTicks.at} = (select max(qt.at) from quick_ticks qt where qt.task_id = ${quickTicks.taskId})`,
      ),
    );
  return qs.map((q) => {
    const t = latest.find((l) => l.taskId === q.id);
    return { taskId: q.id, name: q.name, last: t ? { tickId: t.id, memberId: t.memberId, at: t.at } : null };
  });
}

export const viewRoutes = new Hono<AppEnv>()
  .get("/today", async (c) => {
    const { db, today, me } = c.var;
    const mine = await db
      .select({ occ: occurrences, taskName: tasks.name })
      .from(occurrences)
      .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
      .where(and(eq(occurrences.assigneeId, me.id), eq(occurrences.status, "pending"), lte(occurrences.scheduledDate, today)))
      .orderBy(asc(occurrences.scheduledDate), asc(tasks.name));
    const dtos = mine.map((r) => toOccurrenceDTO(r, today));
    const body: TodayDTO = {
      today,
      dueToday: dtos.filter((o) => o.date === today),
      overdue: dtos.filter((o) => o.date < today),
      quick: await quickTaskList(db),
    };
    return c.json(body);
  })

  .get("/history", async (c) => {
    const { before, limit } = z
      .object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(c.req.query());
    const db = c.var.db;
    const cursor = before ?? "9999";
    const [done, missed, ticks] = await Promise.all([
      db
        .select({ occ: occurrences, taskName: tasks.name })
        .from(occurrences)
        .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
        .where(and(eq(occurrences.status, "done"), lt(occurrences.completedAt, cursor)))
        .orderBy(desc(occurrences.completedAt))
        .limit(limit),
      db
        .select({ occ: occurrences, taskName: tasks.name })
        .from(occurrences)
        .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
        .where(and(eq(occurrences.status, "missed"), lt(occurrences.missedAt, cursor)))
        .orderBy(desc(occurrences.missedAt))
        .limit(limit),
      db
        .select({ tick: quickTicks, taskName: tasks.name })
        .from(quickTicks)
        .innerJoin(tasks, eq(tasks.id, quickTicks.taskId))
        .where(lt(quickTicks.at, cursor))
        .orderBy(desc(quickTicks.at))
        .limit(limit),
    ]);
    const items: HistoryItem[] = [
      ...done.map(({ occ, taskName }) => ({
        kind: "done" as const,
        at: occ.completedAt!,
        occurrenceId: occ.id,
        taskName,
        date: occ.scheduledDate,
        assigneeId: occ.assigneeId,
        doneById: occ.completedById!,
      })),
      ...missed.map(({ occ, taskName }) => ({
        kind: "missed" as const,
        at: occ.missedAt!,
        occurrenceId: occ.id,
        taskName,
        date: occ.scheduledDate,
        assigneeId: occ.assigneeId,
      })),
      ...ticks.map(({ tick, taskName }) => ({ kind: "tick" as const, at: tick.at, tickId: tick.id, taskName, memberId: tick.memberId })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);
    const body: HistoryDTO = { items, nextCursor: items.length === limit ? items[items.length - 1].at : null };
    return c.json(body);
  });
