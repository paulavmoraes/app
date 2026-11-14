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
  /** Beyond the stored horizon: computed on the fly, can't be swapped yet. */
  projected?: boolean;
};

export type CalendarDTO = { from: string; to: string; today: string; occurrences: OccurrenceDTO[] };

export type HomeDTO = { today: string; groups: { memberId: string; items: OccurrenceDTO[] }[] };

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
  /** Extra shifts I owe that haven't been given a date yet. */
  owedShifts: number;
};

export type SwapDTO = { id: string; fromMemberId: string; toMemberId: string; createdAt: string; occurrence: OccurrenceDTO };

export type AwayDTO = { id: string; memberId: string; startDate: string; endDate: string };

export type HistoryItem =
  | { kind: "done"; at: string; occurrenceId: string; taskName: string; date: string; assigneeId: string; doneById: string }
  | { kind: "missed"; at: string; occurrenceId: string; taskName: string; date: string; assigneeId: string }
  | { kind: "tick"; at: string; tickId: string; taskName: string; memberId: string }
  | { kind: "swap"; at: string; swapId: string; taskName: string; date: string; fromMemberId: string; toMemberId: string };

export type HistoryDTO = { items: HistoryItem[]; nextCursor: string | null };
