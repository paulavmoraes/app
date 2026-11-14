import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./db/schema";
import type { Member } from "../shared/types";

export type Env = {
  DB: D1Database;
  APP_TIMEZONE: string;
  /** Guards the one-time household setup. */
  SETUP_TOKEN?: string;
  /** Dev/test only: pretend the current time is this ISO instant. */
  FAKE_NOW?: string;
  /** Dev/test only: "1" lets a request set the time with an `x-test-now` header. Never set in production. */
  TEST_CLOCK?: string;
};

export type Db = DrizzleD1Database<typeof schema>;

export type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; now: Date; today: string; me: Member };
};
