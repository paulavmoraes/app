import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { AppEnv, Db } from "../env";
import { members, sessions } from "../db/schema";
import { randomToken, sha256 } from "./tokens";
import { unauthorized } from "./errors";

const COOKIE = "sid";
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function startSession(c: Context<AppEnv>, memberId: string) {
  const token = randomToken();
  const nowIso = c.var.now.toISOString();
  await c.var.db.insert(sessions).values({ tokenHash: await sha256(token), memberId, createdAt: nowIso, lastSeenAt: nowIso });
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: ONE_YEAR });
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.var.db.delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function currentMember(c: Context<AppEnv>, db: Db) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const [row] = await db
    .select({ member: members, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(members, eq(members.id, sessions.memberId))
    .where(eq(sessions.tokenHash, hash));
  if (!row) return null;
  // Touch at most once a day.
  if (row.lastSeenAt.slice(0, 10) !== c.var.now.toISOString().slice(0, 10)) {
    await db.update(sessions).set({ lastSeenAt: c.var.now.toISOString() }).where(eq(sessions.tokenHash, hash));
  }
  const { id, displayName, color } = row.member;
  return { id, displayName, color };
}

export const requireMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  const me = await currentMember(c, c.var.db);
  if (!me) throw unauthorized();
  c.set("me", me);
  await next();
};
