import { buildPushPayload } from "@block65/webcrypto-web-push";
import { eq } from "drizzle-orm";
import type { Db, Env } from "../env";
import { pushSubscriptions } from "../db/schema";

export type Vapid = { subject: string; publicKey: string; privateKey: string };
export type PushPayload = { title: string; body: string; url: string; tag?: string };

export function vapidFrom(env: Env): Vapid | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}

/** Sends to every device of a member. Subscriptions the push service says are gone are deleted. Never throws. */
export async function sendPush(db: Db, vapid: Vapid | null, memberId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  if (!vapid) return result;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.memberId, memberId));
  await Promise.all(
    subs.map(async (s) => {
      try {
        const req = await buildPushPayload(
          { data: payload, options: { ttl: 24 * 3600, urgency: "normal" } },
          { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
          vapid,
        );
        const res = await fetch(s.endpoint, req as RequestInit);
        if (res.status === 404 || res.status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        if (res.ok) result.sent++;
        else {
          result.failed++;
          console.warn(`push failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
      } catch (err) {
        result.failed++;
        console.warn("push error", err);
      }
    }),
  );
  return result;
}
