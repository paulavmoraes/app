import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useMemberMap } from "../hooks";
import { formatDate, formatTime, londonDate } from "../format";
import type { HistoryDTO, HistoryItem } from "../../shared/types";
import { Avatar, Button, Empty, ErrorText } from "../components/ui";

export function HistoryScreen() {
  const members = useMemberMap();
  const q = useInfiniteQuery({
    queryKey: ["history"],
    queryFn: ({ pageParam }) => api.get<HistoryDTO>(`/history${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const groups: { day: string; items: HistoryItem[] }[] = [];
  for (const it of items) {
    const day = londonDate(it.at);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(it);
  }
  const name = (id: string) => members.get(id)?.displayName ?? "Someone";

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">History</h1>
      <ErrorText error={q.error} />
      {q.data && items.length === 0 && <Empty>Nothing yet.</Empty>}
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">{formatDate(g.day, { weekday: "long", day: "numeric", month: "long" })}</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
            {g.items.map((it) => {
              const who = it.kind === "done" ? it.doneById : it.kind === "tick" ? it.memberId : it.kind === "swap" ? it.toMemberId : it.assigneeId;
              const key = it.kind === "tick" ? it.tickId : it.kind === "swap" ? it.swapId : it.occurrenceId;
              return (
                <li key={`${it.kind}-${key}`} className="flex items-center gap-3 p-3">
                  <Avatar member={members.get(who)} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {it.kind === "missed" ? "❌ " : it.kind === "swap" ? "⇄ " : "✓ "}
                      <span className="font-medium">{it.taskName}</span>
                    </p>
                    <p className="text-sm text-slate-500">
                      {it.kind === "done" &&
                        `${name(it.doneById)}${it.doneById !== it.assigneeId ? ` (assigned to ${name(it.assigneeId)})` : ""} · due ${formatDate(it.date)}`}
                      {it.kind === "tick" && name(it.memberId)}
                      {it.kind === "swap" && `${name(it.toMemberId)} took ${formatDate(it.date)} from ${name(it.fromMemberId)}`}
                      {it.kind === "missed" && `Missed by ${name(it.assigneeId)} · was due ${formatDate(it.date)}`}
                    </p>
                  </div>
                  <span className="text-sm text-slate-500">{formatTime(it.at)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {q.hasNextPage && (
        <Button variant="secondary" className="w-full" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </div>
  );
}
