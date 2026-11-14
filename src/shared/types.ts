import type { Assignment } from "../domain/assign";
import type { Schedule } from "../domain/schedule";

export type Member = { id: string; displayName: string; color: string };

export type SessionInfo = {
  setupNeeded: boolean;
  me: Member | null;
  household: { name: string } | null;
};

export type TaskDTO = {
  id: string;
  name: string;
  kind: "recurring" | "quick";
  archivedAt: string | null;
  schedule: Schedule | null;
  assignment: Assignment | null;
};

export type OccurrenceDTO = {
  id: string;
  taskId: string;
  taskName: string;
  date: string;
  status: "pending" | "done" | "missed" | "cancelled";
  assigneeId: string;
  override: "swap" | "penalty" | "away_cover" | null;
  daysOverdue: number;
  completedAt: string | null;
  completedById: string | null;
};

export type QuickTaskDTO = {
  taskId: string;
  name: string;
  last: { tickId: string; memberId: string; at: string } | null;
};

export type TodayDTO = {
  today: string;
  dueToday: OccurrenceDTO[];
  overdue: OccurrenceDTO[];
  quick: QuickTaskDTO[];
};

export type HistoryItem =
  | { kind: "done"; at: string; occurrenceId: string; taskName: string; date: string; assigneeId: string; doneById: string }
  | { kind: "missed"; at: string; occurrenceId: string; taskName: string; date: string; assigneeId: string }
  | { kind: "tick"; at: string; tickId: string; taskName: string; memberId: string };

export type HistoryDTO = { items: HistoryItem[]; nextCursor: string | null };
