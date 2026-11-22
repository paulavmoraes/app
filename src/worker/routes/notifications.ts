import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../env";
import { notifications, pushSubscriptions } from "../db/schema";
import type { InboxDTO } from "../../shared/types";
import { newId } from "../lib/tokens";
import { badRequest } from "../lib/errors";
import { sendPush, vapidFrom } from "../services/push";

export const notificationRoutes = new Hono<AppEnv>()
  .get("/notifications", async (c) => {
    const { db, me } = c.var;
    const rows = await db.select().from(notifications).where(eq(notifications.memberId, me.id)).orderBy(desc(notifications.createdAt)).limit(60);
    const unread = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.memberId, me.id), isNull(notifications.readAt)));
    const body: InboxDTO = {
      unread: unread.length,
      items: rows.map(({ id, type, title, body, createdAt, readAt }) => ({ id, type, title, body, createdAt, readAt })),
    };
    return c.json(body);
  })

  .post("/notifications/read", async (c) => {
    const { db, me, now } = c.var;
    await db.update(notifications).set({ readAt: now.toISOString() }).where(and(eq(notifications.memberId, me.id), isNull(notifications.readAt)));
    return c.json({ ok: true });
  })

  .get("/push/key", (c) => c.json({ publicKey: vapidFrom(c.env)?.publicKey ?? null }))

  // Register this device. The same endpoint signing in as someone else moves to that member.
  .post("/push/subscription", async (c) => {
    const { db, me, now } = c.var;
    const sub = z
      .object({ endpoint: z.string().url().startsWith("https://"), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) })
      .parse(await c.req.json());
    await db
      .insert(pushSubscriptions)
      .values({ id: newId(), memberId: me.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, createdAt: now.toISOString() })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { memberId: me.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    return c.json({ ok: true }, 201);
  })

  .post("/push/unsubscribe", async (c) => {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(await c.req.json());
    await c.var.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.memberId, c.var.me.id)));
    return c.json({ ok: true });
  })

  .post("/push/test", async (c) => {
    const vapid = vapidFrom(c.env);
    if (!vapid) throw badRequest("Push isn't configured on the server yet");
    const result = await sendPush(c.var.db, vapid, c.var.me.id, { title: "Chores", body: "Push notifications are working 🎉", url: "/notifications", tag: "test" });
    return c.json(result);
  });
