import type { Db } from "../env";
import { notifications } from "../db/schema";
import type { ISODate } from "../../domain/dates";
import { newId } from "../lib/tokens";

export type NotifyCtx = { now: Date; today: ISODate; isAway: (memberId: string, date: ISODate) => boolean };
export type Notice = { type: string; title: string; body: string; data?: Record<string, unknown> };

/** Adds an inbox item (web push is added in phase 4). Members who are away today get nothing. */
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
}
