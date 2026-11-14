import { and, asc, eq, gte, isNull, lt, lte, ne } from "drizzle-orm";
import type { Db } from "../env";
import { jobRuns, members, occurrences, penalties, swapRequests, taskVersions, tasks } from "../db/schema";
import { diffDays, hourInTz, type ISODate } from "../../domain/dates";
import { hasFixedSeries, type Schedule } from "../../domain/schedule";
import type { AssignCtx } from "../../domain/assign";
import { assignPenalties, findMissed, penaltyApplies, type SeriesRow } from "../../domain/penalty";
import { newId } from "../lib/tokens";
import { loadAssignCtx } from "./context";
import { materializeAll } from "./materialize";
import { notify } from "./notify";
import type { Vapid } from "./push";

const fmt = (d: ISODate) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** Everything that keeps the schedule up to date. Idempotent; runs on authed GETs and from the hourly cron. */
export async function runMaintenance(db: Db, today: ISODate, now: Date, tz: string, vapid: Vapid | null) {
  const ctx = await loadAssignCtx(db);
  await materializeAll(db, today, now, tz, ctx);
  await detectMissed(db, today, now, ctx, vapid);
  await applyOwedPenalties(db, today, now, ctx, vapid);
  return ctx;
}

/**
 * The 09:00 summary: each member's tasks due today and overdue tasks (this is also the daily overdue reminder).
 * Sent once per day (`job_runs`), on the first cron run from 09:00 London time; skipped for members with nothing to do.
 */
export async function sendDailySummary(db: Db, today: ISODate, now: Date, tz: string, ctx: AssignCtx, vapid: Vapid | null) {
  const hour = hourInTz(now, tz);
  if (hour < 9 || hour >= 21) return false;
  const key = `daily-summary:${today}`;
  const claimed = await db.insert(jobRuns).values({ key, ranAt: now.toISOString() }).onConflictDoNothing().returning({ key: jobRuns.key });
  if (!claimed.length) return false;
  const due = await db
    .select({ occ: occurrences, taskName: tasks.name })
    .from(occurrences)
    .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
    .where(and(eq(occurrences.status, "pending"), lte(occurrences.scheduledDate, today), isNull(tasks.archivedAt)))
    .orderBy(asc(occurrences.scheduledDate), asc(tasks.name));
  const all = await db.select().from(members);
  for (const m of all) {
    const mine = due.filter((d) => d.occ.assigneeId === m.id);
    if (!mine.length) continue;
    const todays = mine.filter((d) => d.occ.scheduledDate === today).map((d) => d.taskName);
    const overdue = mine.filter((d) => d.occ.scheduledDate < today).map((d) => `${d.taskName} (overdue by ${daysLabel(diffDays(today, d.occ.scheduledDate))})`);
    const body = [todays.length ? `Today: ${todays.join(", ")}` : "", overdue.length ? `Overdue: ${overdue.join(", ")}` : ""].filter(Boolean).join("\n");
    await notify(db, { now, today, isAway: ctx.isAway, vapid }, m.id, { type: "daily_summary", title: "Today's chores", body, url: "/" });
  }
  return true;
}
const daysLabel = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Overdue occurrences whose next occurrence has arrived become missed, and the assignee owes an extra shift. */
export async function detectMissed(db: Db, today: ISODate, now: Date, ctx: AssignCtx, vapid: Vapid | null) {
  const overdue = await db
    .select({ occ: occurrences, taskName: tasks.name, schedule: taskVersions.schedule })
    .from(occurrences)
    .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
    .innerJoin(taskVersions, and(eq(taskVersions.taskId, tasks.id), isNull(taskVersions.effectiveTo)))
    .where(and(eq(occurrences.status, "pending"), lt(occurrences.scheduledDate, today), isNull(tasks.archivedAt)));
  const byTask = new Map<string, { name: string; minDate: ISODate }>();
  for (const r of overdue) {
    if (!hasFixedSeries(r.schedule as Schedule)) continue; // counted from completion: never missed
    const cur = byTask.get(r.occ.taskId);
    if (!cur || r.occ.scheduledDate < cur.minDate) byTask.set(r.occ.taskId, { name: r.taskName, minDate: cur && cur.minDate < r.occ.scheduledDate ? cur.minDate : r.occ.scheduledDate });
  }
  const nowIso = now.toISOString();
  const nctx = { now, today, isAway: ctx.isAway, vapid };

  for (const [taskId, info] of byTask) {
    const rows = await db
      .select()
      .from(occurrences)
      .where(and(eq(occurrences.taskId, taskId), ne(occurrences.status, "cancelled"), gte(occurrences.scheduledDate, info.minDate), lte(occurrences.scheduledDate, today)));
    const missed = findMissed(rows.map((r) => ({ id: r.id, date: r.scheduledDate, status: r.status, assigneeId: r.assigneeId }) as SeriesRow), today);
    for (const m of missed) {
      const penalised = penaltyApplies(m, ctx.isAway);
      await db.batch([
        db.update(occurrences).set({ status: "missed", missedAt: nowIso }).where(and(eq(occurrences.id, m.id), eq(occurrences.status, "pending"))),
        db.update(swapRequests).set({ status: "cancelled", respondedAt: nowIso }).where(and(eq(swapRequests.occurrenceId, m.id), eq(swapRequests.status, "pending"))),
        ...(penalised
          ? [db.insert(penalties).values({ id: newId(), debtorId: m.assigneeId, missedOccurrenceId: m.id, status: "owed", createdAt: nowIso })]
          : []),
      ] as never);
      await notify(db, nctx, m.assigneeId, {
        type: "missed",
        title: `Missed: ${info.name}`,
        body: `${info.name} for ${fmt(m.date)} wasn't done before the next one came up${penalised ? ", so you owe one extra shift." : "."}`,
        data: { occurrenceId: m.id },
      });
    }
  }
}

/** Turn owed extra shifts into actual occurrences taken over from someone else. */
export async function applyOwedPenalties(db: Db, today: ISODate, now: Date, ctx: AssignCtx, vapid: Vapid | null) {
  const owed = await db
    .select({ penalty: penalties, taskId: occurrences.taskId })
    .from(penalties)
    .innerJoin(occurrences, eq(occurrences.id, penalties.missedOccurrenceId))
    .where(eq(penalties.status, "owed"))
    .orderBy(asc(penalties.createdAt));
  if (!owed.length) return;
  const candidates = await db
    .select({ occ: occurrences, taskName: tasks.name })
    .from(occurrences)
    .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
    .where(and(eq(occurrences.status, "pending"), gte(occurrences.scheduledDate, today), isNull(tasks.archivedAt)));
  const assignments = assignPenalties(
    owed.map((o) => ({ penaltyId: o.penalty.id, debtorId: o.penalty.debtorId, taskId: o.taskId })),
    candidates.map((c) => ({ id: c.occ.id, taskId: c.occ.taskId, date: c.occ.scheduledDate, assigneeId: c.occ.assigneeId, override: c.occ.override })),
    today,
    ctx.isAway,
  );
  if (!assignments.length) return;
  const nowIso = now.toISOString();
  const names = new Map((await db.select().from(members)).map((m) => [m.id, m.displayName]));
  const nctx = { now, today, isAway: ctx.isAway, vapid };
  for (const a of assignments) {
    const target = candidates.find((c) => c.occ.id === a.occurrenceId)!;
    const missedId = owed.find((o) => o.penalty.id === a.penaltyId)!.penalty.missedOccurrenceId;
    await db.batch([
      db.update(occurrences).set({ assigneeId: a.debtorId, override: "penalty", penaltyForOccurrenceId: missedId }).where(eq(occurrences.id, a.occurrenceId)),
      db.update(penalties).set({ status: "applied", appliedOccurrenceId: a.occurrenceId }).where(eq(penalties.id, a.penaltyId)),
      db.update(swapRequests).set({ status: "cancelled", respondedAt: nowIso }).where(and(eq(swapRequests.occurrenceId, a.occurrenceId), eq(swapRequests.status, "pending"))),
    ]);
    const what = `${target.taskName} on ${fmt(target.occ.scheduledDate)}`;
    await notify(db, nctx, a.debtorId, { type: "penalty", title: "Extra shift", body: `Your extra shift is ${what}.`, data: { occurrenceId: a.occurrenceId }, url: "/" });
    await notify(db, nctx, a.freedMemberId, {
      type: "penalty_freed",
      title: "You're off the hook",
      body: `${names.get(a.debtorId) ?? "Someone"} is doing ${what} as an extra shift.`,
      data: { occurrenceId: a.occurrenceId },
    });
  }
}

