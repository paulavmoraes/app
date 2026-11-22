import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, gt, isNull, max } from "drizzle-orm";
import type { AppEnv } from "../env";
import { household, inviteLinks, members, pairingCodes } from "../db/schema";
import { MEMBER_COLORS } from "../../shared/colors";
import type { SessionInfo } from "../../shared/types";
import { newId, pairingCode, randomToken, sha256 } from "../lib/tokens";
import { badRequest, conflict, notFound } from "../lib/errors";
import { currentMember, endSession, requireMember, startSession } from "../lib/session";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const PAIRING_TTL_MS = 10 * 60 * 1000;

const profile = z.object({
  displayName: z.string().trim().min(1).max(30),
  color: z.enum(MEMBER_COLORS),
});

async function addMember(c: { var: AppEnv["Variables"] }, p: z.infer<typeof profile>) {
  const db = c.var.db;
  const [taken] = await db.select({ id: members.id }).from(members).where(eq(members.color, p.color));
  if (taken) throw conflict("That colour is already taken");
  const [{ maxOrder }] = await db.select({ maxOrder: max(members.sortOrder) }).from(members);
  const id = newId();
  await db.insert(members).values({ id, ...p, sortOrder: (maxOrder ?? -1) + 1, joinedAt: c.var.now.toISOString() });
  return id;
}

export const authRoutes = new Hono<AppEnv>()
  .get("/session", async (c) => {
    const [h] = await c.var.db.select().from(household).limit(1);
    const me = h ? await currentMember(c, c.var.db) : null;
    const body: SessionInfo = { setupNeeded: !h, me, household: h ? { name: h.name } : null };
    return c.json(body);
  })

  .post("/setup", async (c) => {
    const body = profile.extend({ token: z.string(), householdName: z.string().trim().min(1).max(40) }).parse(await c.req.json());
    if (!c.env.SETUP_TOKEN || body.token !== c.env.SETUP_TOKEN) throw badRequest("Invalid setup token");
    const [h] = await c.var.db.select().from(household).limit(1);
    if (h) throw conflict("Household already set up");
    await c.var.db.insert(household).values({ id: newId(), name: body.householdName, createdAt: c.var.now.toISOString() });
    const id = await addMember(c, body);
    await startSession(c, id);
    return c.json({ ok: true });
  })

  .get("/colors/available", async (c) => {
    const used = new Set((await c.var.db.select({ color: members.color }).from(members)).map((m) => m.color));
    return c.json(MEMBER_COLORS.filter((col) => !used.has(col)));
  })

  // ---- Invite links (join a new person, or sign an existing person in on a new device)
  .get("/invites/:token", async (c) => {
    const link = await findValidInvite(c.var.db, c.req.param("token"), c.var.now);
    if (!link) throw notFound("This link is invalid, expired or already used");
    let memberName: string | null = null;
    if (link.kind === "device" && link.memberId) {
      const [m] = await c.var.db.select().from(members).where(eq(members.id, link.memberId));
      memberName = m?.displayName ?? null;
    }
    return c.json({ kind: link.kind, memberName });
  })

  .post("/invites/:token/accept", async (c) => {
    const link = await findValidInvite(c.var.db, c.req.param("token"), c.var.now);
    if (!link) throw notFound("This link is invalid, expired or already used");
    let memberId: string;
    if (link.kind === "join") {
      memberId = await addMember(c, profile.parse(await c.req.json()));
    } else {
      memberId = link.memberId!;
    }
    await c.var.db.update(inviteLinks).set({ usedAt: c.var.now.toISOString() }).where(eq(inviteLinks.tokenHash, link.tokenHash));
    await startSession(c, memberId);
    return c.json({ ok: true });
  })

  .post("/pair", async (c) => {
    const { code } = z.object({ code: z.string().trim().toUpperCase().length(6) }).parse(await c.req.json());
    const nowIso = c.var.now.toISOString();
    const [row] = await c.var.db
      .select()
      .from(pairingCodes)
      .where(and(eq(pairingCodes.code, code), isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, nowIso)));
    if (!row) throw badRequest("That code is invalid or expired");
    await c.var.db.update(pairingCodes).set({ usedAt: nowIso }).where(eq(pairingCodes.code, code));
    await startSession(c, row.memberId);
    return c.json({ ok: true });
  })

  .post("/logout", async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  })

  // ---- Signed-in only
  .use("/invites", requireMember)
  .post("/invites", async (c) => {
    const body = z
      .discriminatedUnion("kind", [z.object({ kind: z.literal("join") }), z.object({ kind: z.literal("device"), memberId: z.string() })])
      .parse(await c.req.json());
    if (body.kind === "device") {
      const [m] = await c.var.db.select().from(members).where(eq(members.id, body.memberId));
      if (!m) throw notFound("No such member");
    }
    const token = randomToken();
    const expiresAt = new Date(c.var.now.getTime() + INVITE_TTL_MS).toISOString();
    await c.var.db.insert(inviteLinks).values({
      tokenHash: await sha256(token),
      kind: body.kind,
      memberId: body.kind === "device" ? body.memberId : null,
      createdBy: c.var.me.id,
      createdAt: c.var.now.toISOString(),
      expiresAt,
    });
    const url = new URL(`/join/${token}`, c.req.url).toString();
    return c.json({ url, expiresAt });
  })

  .use("/pairing-code", requireMember)
  .post("/pairing-code", async (c) => {
    const code = pairingCode();
    const expiresAt = new Date(c.var.now.getTime() + PAIRING_TTL_MS).toISOString();
    await c.var.db.insert(pairingCodes).values({ code, memberId: c.var.me.id, expiresAt });
    return c.json({ code, expiresAt });
  })

  .use("/members", requireMember)
  .get("/members", async (c) => {
    const rows = await c.var.db.select().from(members).orderBy(asc(members.sortOrder));
    return c.json(rows.map(({ id, displayName, color }) => ({ id, displayName, color })));
  })

  .use("/me", requireMember)
  .patch("/me", async (c) => {
    const p = profile.partial().parse(await c.req.json());
    if (p.color && p.color !== c.var.me.color) {
      const [taken] = await c.var.db.select({ id: members.id }).from(members).where(eq(members.color, p.color));
      if (taken) throw conflict("That colour is already taken");
    }
    await c.var.db.update(members).set(p).where(eq(members.id, c.var.me.id));
    return c.json({ ok: true });
  });

async function findValidInvite(db: AppEnv["Variables"]["db"], token: string, now: Date) {
  const [link] = await db
    .select()
    .from(inviteLinks)
    .where(and(eq(inviteLinks.tokenHash, await sha256(token)), isNull(inviteLinks.usedAt), gt(inviteLinks.expiresAt, now.toISOString())));
  return link ?? null;
}
