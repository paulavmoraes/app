import type { Db } from "../env";
import { notifications } from "../db/schema";
import type { ISODate } from "../../domain/dates";
import { newId } from "../lib/tokens";
import { sendPush, type Vapid } from "./push";

export type NotifyCtx = { now: Date; today: ISODate; isAway: (memberId: string, date: ISODate) => boolean; vapid: Vapid | null };
export type Notice = { type: string; title: string; body: string; data?: Record<string, unknown>; /** Where tapping the push opens. */ url?: string };

/** Adds an inbox item and sends the same thing as a web push. Members who are away today get nothing. */
export async function notify(db: Db, ctx: NotifyCtx, memberId: string, n: Notice) {
  if (ctx.isAway(memberId, ctx.today)) return;
  await db.insert(notifications).values({
    id: newId(),
    memberId,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data ?? null,
    createdAt: ctx.now.toISOString(),
  });
  await sendPush(db, ctx.vapid, memberId, { title: n.title, body: n.body, url: n.url ?? "/notifications", tag: n.type });
}
