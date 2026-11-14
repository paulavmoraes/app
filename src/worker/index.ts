import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import { ZodError } from "zod";
import * as schema from "./db/schema";
import type { AppEnv, Env } from "./env";
import { dateInTz } from "../domain/dates";
import { requireMember } from "./lib/session";
import { authRoutes } from "./routes/auth";
import { taskRoutes } from "./routes/tasks";
import { occurrenceRoutes, quickRoutes } from "./routes/occurrences";
import { viewRoutes } from "./routes/views";
import { materializeAll } from "./services/materialize";

export function clock(env: Env): Date {
  return env.FAKE_NOW ? new Date(env.FAKE_NOW) : new Date();
}

const app = new Hono<AppEnv>().basePath("/api");

app.use(async (c, next) => {
  const now = clock(c.env);
  c.set("now", now);
  c.set("today", dateInTz(now, c.env.APP_TIMEZONE));
  c.set("db", drizzle(c.env.DB, { schema }));
  await next();
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof ZodError) return c.json({ error: "Invalid input", issues: err.issues }, 400);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes);

// Everything below needs a signed-in member. Views also top up the stored occurrences.
const authed = new Hono<AppEnv>();
authed.use(requireMember);
authed.use(async (c, next) => {
  if (c.req.method === "GET") await materializeAll(c.var.db, c.var.today, c.var.now, c.env.APP_TIMEZONE);
  await next();
});
authed.route("/tasks", taskRoutes);
authed.route("/occurrences", occurrenceRoutes);
authed.route("/quick", quickRoutes);
authed.route("/", viewRoutes);
app.route("/", authed);

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const now = clock(env);
    const db = drizzle(env.DB, { schema });
    await materializeAll(db, dateInTz(now, env.APP_TIMEZONE), now, env.APP_TIMEZONE);
    // Missed detection and the 09:00 daily summary arrive in phases 3 and 4.
  },
} satisfies ExportedHandler<Env>;
