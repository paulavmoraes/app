import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const household = sqliteTable("household", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Europe/London"),
  createdAt: text("created_at").notNull(),
});

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    color: text("color").notNull(),
    sortOrder: integer("sort_order").notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (t) => [uniqueIndex("members_color_uq").on(t.color)],
);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const inviteLinks = sqliteTable("invite_links", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind", { enum: ["join", "device"] }).notNull(),
  memberId: text("member_id").references(() => members.id),
  createdBy: text("created_by").notNull().references(() => members.id),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

export const pairingCodes = sqliteTable("pairing_codes", {
  code: text("code").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["recurring", "quick"] }).notNull(),
  createdAt: text("created_at").notNull(),
  archivedAt: text("archived_at"),
});

/** Each edit closes the current version and opens a new one, so past occurrences keep their rules. */
export const taskVersions = sqliteTable(
  "task_versions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    /** JSON: domain `Schedule`. */
    schedule: text("schedule", { mode: "json" }).notNull(),
    /** JSON: domain `Assignment`. */
    assignment: text("assignment", { mode: "json" }).notNull(),
    rotationStartIndex: integer("rotation_start_index").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("task_versions_task_idx").on(t.taskId)],
);

export const occurrences = sqliteTable(
  "occurrences",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    versionId: text("version_id").notNull().references(() => taskVersions.id),
    scheduledDate: text("scheduled_date").notNull(),
    status: text("status", { enum: ["pending", "done", "missed", "cancelled"] }).notNull(),
    generatedAssigneeId: text("generated_assignee_id").notNull(),
    assigneeId: text("assignee_id").notNull(),
    override: text("override", { enum: ["swap", "penalty", "away_cover"] }),
    allAway: integer("all_away", { mode: "boolean" }).notNull().default(false),
    /** Rotation state after this occurrence, so generation can continue from here. */
    pointerAfter: integer("pointer_after").notNull(),
    coverAfter: integer("cover_after").notNull(),
    completedAt: text("completed_at"),
    completedById: text("completed_by_id"),
    /** For completion-anchored tasks: the occurrence whose completion created this one. */
    spawnedById: text("spawned_by_id"),
    missedAt: text("missed_at"),
    penaltyForOccurrenceId: text("penalty_for_occurrence_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("occurrences_task_date_uq").on(t.taskId, t.scheduledDate),
    index("occurrences_date_idx").on(t.scheduledDate),
    index("occurrences_assignee_idx").on(t.assigneeId, t.status),
  ],
);

export const penalties = sqliteTable("penalties", {
  id: text("id").primaryKey(),
  debtorId: text("debtor_id").notNull().references(() => members.id),
  missedOccurrenceId: text("missed_occurrence_id").notNull().references(() => occurrences.id),
  status: text("status", { enum: ["owed", "applied"] }).notNull(),
  appliedOccurrenceId: text("applied_occurrence_id"),
  createdAt: text("created_at").notNull(),
});

export const swapRequests = sqliteTable("swap_requests", {
  id: text("id").primaryKey(),
  occurrenceId: text("occurrence_id").notNull().references(() => occurrences.id),
  fromMemberId: text("from_member_id").notNull().references(() => members.id),
  toMemberId: text("to_member_id").notNull().references(() => members.id),
  status: text("status", { enum: ["pending", "accepted", "declined", "cancelled"] }).notNull(),
  createdAt: text("created_at").notNull(),
  respondedAt: text("responded_at"),
});

export const awayPeriods = sqliteTable("away_periods", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  createdAt: text("created_at").notNull(),
});

export const quickTicks = sqliteTable(
  "quick_ticks",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    memberId: text("member_id").notNull().references(() => members.id),
    at: text("at").notNull(),
  },
  (t) => [index("quick_ticks_task_idx").on(t.taskId, t.at)],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: text("data", { mode: "json" }),
    createdAt: text("created_at").notNull(),
    readAt: text("read_at"),
  },
  (t) => [index("notifications_member_idx").on(t.memberId, t.createdAt)],
);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: text("created_at").notNull(),
});

export const jobRuns = sqliteTable("job_runs", {
  key: text("key").primaryKey(),
  ranAt: text("ran_at").notNull(),
});
