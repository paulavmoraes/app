import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { AppEnv } from "../env";
import { members, occurrences, penalties, quickTicks, swapRequests, tasks } from "../db/schema";
import { daysOverdue } from "../../domain/generate";
import type { CalendarDTO, HistoryDTO, HistoryItem, HomeDTO, OccurrenceDTO, QuickTaskDTO, TodayDTO } from "../../shared/types";
import { diffDays, isISODate } from "../../domain/dates";
import { badRequest } from "../lib/errors";
import { projectedOccurrences } from "../services/project";
import { loadAssignCtx } from "../services/context";

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
      owedShifts: (await db.select({ id: penalties.id }).from(penalties).where(and(eq(penalties.debtorId, me.id), eq(penalties.status, "owed")))).length,
    };
    return c.json(body);
  })

  .get("/calendar", async (c) => {
    const { from, to } = z.object({ from: z.string().refine(isISODate), to: z.string().refine(isISODate) }).parse(c.req.query());
    if (to < from || diffDays(to, from) > 62) throw badRequest("Range must be 1–62 days");
    const { db, today } = c.var;
    const stored = await db
      .select({ occ: occurrences, taskName: tasks.name })
      .from(occurrences)
      .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
      .where(and(gte(occurrences.scheduledDate, from), lte(occurrences.scheduledDate, to), inArray(occurrences.status, ["pending", "done", "missed"])));
    const names = new Map((await db.select({ id: tasks.id, name: tasks.name }).from(tasks)).map((t) => [t.id, t.name]));
    const projected: OccurrenceDTO[] = (await projectedOccurrences(db, from, to, await loadAssignCtx(db))).map((p) => ({
      id: `projected:${p.taskId}:${p.date}`,
      taskId: p.taskId,
      taskName: names.get(p.taskId) ?? "",
      date: p.date,
      status: "pending",
      assigneeId: p.assigneeId,
      override: p.override,
      daysOverdue: 0,
      completedAt: null,
      completedById: null,
      projected: true,
    }));
    const all = [...stored.map((r) => toOccurrenceDTO(r, today)), ...projected].sort((a, b) =>
      a.date === b.date ? a.taskName.localeCompare(b.taskName) : a.date < b.date ? -1 : 1,
    );
    const body: CalendarDTO = { from, to, today, occurrences: all };
    return c.json(body);
  })

  .get("/home", async (c) => {
    const { db, today } = c.var;
    const pending = await db
      .select({ occ: occurrences, taskName: tasks.name })
      .from(occurrences)
      .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
      .where(and(eq(occurrences.status, "pending"), isNull(tasks.archivedAt)))
      .orderBy(asc(occurrences.scheduledDate));
    // Per task: everything due up to today, or else just the next one.
    const picked: OccurrenceDTO[] = [];
    const seen = new Set<string>();
    for (const r of pending) {
      const due = r.occ.scheduledDate <= today;
      if (due || !seen.has(r.occ.taskId)) picked.push(toOccurrenceDTO(r, today));
      seen.add(r.occ.taskId);
    }
    const ms = await db.select({ id: members.id }).from(members).orderBy(asc(members.sortOrder));
    const body: HomeDTO = {
      today,
      groups: ms.map((m) => ({ memberId: m.id, items: picked.filter((o) => o.assigneeId === m.id) })),
    };
    return c.json(body);
  })

  .get("/history", async (c) => {
    const { before, limit } = z
      .object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(c.req.query());
    const db = c.var.db;
    const cursor = before ?? "9999";
    const [done, missed, ticks, swaps] = await Promise.all([
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
      db
        .select({ swap: swapRequests, date: occurrences.scheduledDate, taskName: tasks.name })
        .from(swapRequests)
        .innerJoin(occurrences, eq(occurrences.id, swapRequests.occurrenceId))
        .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
        .where(and(eq(swapRequests.status, "accepted"), lt(swapRequests.respondedAt, cursor)))
        .orderBy(desc(swapRequests.respondedAt))
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
      ...swaps.map(({ swap, date, taskName }) => ({
        kind: "swap" as const,
        at: swap.respondedAt!,
        swapId: swap.id,
        taskName,
        date,
        fromMemberId: swap.fromMemberId,
        toMemberId: swap.toMemberId,
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);
    const body: HistoryDTO = { items, nextCursor: items.length === limit ? items[items.length - 1].at : null };
    return c.json(body);
  });
