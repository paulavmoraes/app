import { Hono } from "hono";

export type Env = {
  DB: D1Database;
  APP_TIMEZONE: string;
  SETUP_TOKEN?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    // Hourly maintenance (horizon, missed detection, daily summary) arrives in later phases.
  },
} satisfies ExportedHandler<Env>;
