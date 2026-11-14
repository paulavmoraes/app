import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, or } from "drizzle-orm";
import type { AppEnv } from "../env";
import { members, occurrences, swapRequests, tasks } from "../db/schema";
import type { SwapDTO } from "../../shared/types";
import { newId } from "../lib/tokens";
import { badRequest, conflict, notFound } from "../lib/errors";
import { loadAssignCtx } from "../services/context";
import { notify } from "../services/notify";
import { vapidFrom } from "../services/push";
import { toOccurrenceDTO } from "./views";

const fmt = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export const swapRoutes = new Hono<AppEnv>()
  // Pending proposals I sent or received.
  .get("/", async (c) => {
    const { db, me, today } = c.var;
    const rows = await db
      .select({ swap: swapRequests, occ: occurrences, taskName: tasks.name })
      .from(swapRequests)
      .innerJoin(occurrences, eq(occurrences.id, swapRequests.occurrenceId))
      .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
      .where(and(eq(swapRequests.status, "pending"), or(eq(swapRequests.fromMemberId, me.id), eq(swapRequests.toMemberId, me.id))))
      .orderBy(asc(occurrences.scheduledDate));
    const body: SwapDTO[] = rows.map((r) => ({
      id: r.swap.id,
      fromMemberId: r.swap.fromMemberId,
      toMemberId: r.swap.toMemberId,
      createdAt: r.swap.createdAt,
      occurrence: toOccurrenceDTO(r, today),
    }));
    return c.json(body);
  })

  .post("/", async (c) => {
    const { db, me, now, today } = c.var;
    const body = z.object({ occurrenceId: z.string(), toMemberId: z.string() }).parse(await c.req.json());
    const [row] = await db
      .select({ occ: occurrences, taskName: tasks.name })
      .from(occurrences)
      .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
      .where(eq(occurrences.id, body.occurrenceId));
    if (!row) throw notFound();
    if (row.occ.status !== "pending") throw conflict("Only upcoming or overdue occurrences can be swapped");
    if (row.occ.assigneeId !== me.id) throw badRequest("You can only swap your own shifts");
    if (body.toMemberId === me.id) throw badRequest("Pick someone else");
    const [to] = await db.select().from(members).where(eq(members.id, body.toMemberId));
    if (!to) throw badRequest("Unknown member");
    const ctx = await loadAssignCtx(db);
    if (ctx.isAway(to.id, row.occ.scheduledDate)) throw conflict(`${to.displayName} is away that day`);
    const [existing] = await db
      .select({ id: swapRequests.id })
      .from(swapRequests)
      .where(and(eq(swapRequests.occurrenceId, row.occ.id), eq(swapRequests.status, "pending")));
    if (existing) throw conflict("There's already a pending swap for this one");
    const id = newId();
    await db.insert(swapRequests).values({ id, occurrenceId: row.occ.id, fromMemberId: me.id, toMemberId: to.id, status: "pending", createdAt: now.toISOString() });
    await notify(db, { now, today, isAway: ctx.isAway, vapid: vapidFrom(c.env) }, to.id, {
      url: "/",
      type: "swap_proposed",
      title: "Swap request",
      body: `${me.displayName} asks you to take ${row.taskName} on ${fmt(row.occ.scheduledDate)}.`,
      data: { swapId: id, occurrenceId: row.occ.id },
    });
    return c.json({ id }, 201);
  })

  .post("/:id/:action{accept|decline|cancel}", async (c) => {
    const { db, me, now, today } = c.var;
    const action = c.req.param("action") as "accept" | "decline" | "cancel";
    const [row] = await db
      .select({ swap: swapRequests, occ: occurrences, taskName: tasks.name })
      .from(swapRequests)
      .innerJoin(occurrences, eq(occurrences.id, swapRequests.occurrenceId))
      .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
      .where(eq(swapRequests.id, c.req.param("id")));
    if (!row) throw notFound();
    const { swap, occ } = row;
    if (swap.status !== "pending") throw conflict("This swap request is no longer open");
    const nowIso = now.toISOString();
    const setStatus = (status: "accepted" | "declined" | "cancelled") =>
      db.update(swapRequests).set({ status, respondedAt: nowIso }).where(eq(swapRequests.id, swap.id));

    if (action === "cancel") {
      if (swap.fromMemberId !== me.id) throw badRequest("Only the person who asked can cancel");
      await setStatus("cancelled");
      return c.json({ ok: true });
    }
    if (swap.toMemberId !== me.id) throw badRequest("This request isn't for you");
    const ctx = await loadAssignCtx(db);
    const nctx = { now, today, isAway: ctx.isAway, vapid: vapidFrom(c.env) };
    const what = `${row.taskName} on ${fmt(occ.scheduledDate)}`;

    if (action === "decline") {
      await setStatus("declined");
      await notify(db, nctx, swap.fromMemberId, { type: "swap_declined", title: "Swap declined", body: `${me.displayName} can't take ${what}.`, data: { occurrenceId: occ.id } });
      return c.json({ ok: true });
    }
    // The occurrence may have changed since the request was made.
    if (occ.status !== "pending" || occ.assigneeId !== swap.fromMemberId) {
      await setStatus("cancelled");
      throw conflict("That shift has changed since the request was made");
    }
    await db.batch([
      setStatus("accepted"),
      // The rotation is untouched: only this one occurrence changes hands.
      db.update(occurrences).set({ assigneeId: me.id, override: "swap" }).where(eq(occurrences.id, occ.id)),
    ]);
    await notify(db, nctx, swap.fromMemberId, { type: "swap_accepted", title: "Swap accepted", body: `${me.displayName} will do ${what}.`, data: { occurrenceId: occ.id } });
    return c.json({ ok: true });
  });
