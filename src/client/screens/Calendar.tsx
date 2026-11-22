import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useMemberMap, useMembers } from "../hooks";
import { formatDate, londonDate, WEEKDAYS } from "../format";
import { addDays, addMonthsClamped, weekdayOf } from "../../domain/dates";
import type { CalendarDTO, OccurrenceDTO, TaskDTO } from "../../shared/types";
import { Button, ErrorText, inputClass } from "../components/ui";
import { OccurrenceSheet } from "../components/OccurrenceSheet";

type View = "month" | "week";

const mondayOf = (d: string) => addDays(d, -weekdayOf(d));

function range(view: View, anchor: string) {
  if (view === "week") {
    const from = mondayOf(anchor);
    return { from, to: addDays(from, 6) };
  }
  const first = `${anchor.slice(0, 8)}01`;
  const last = addDays(addMonthsClamped(first, 1), -1);
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) };
}

export function CalendarScreen() {
  const today = londonDate(new Date().toISOString());
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [taskFilter, setTaskFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [open, setOpen] = useState<OccurrenceDTO | null>(null);
  const members = useMemberMap();
  const { data: memberList = [] } = useMembers();
  const { from, to } = range(view, anchor);
  const cal = useQuery({ queryKey: ["calendar", from, to], queryFn: () => api.get<CalendarDTO>(`/calendar?from=${from}&to=${to}`) });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => api.get<TaskDTO[]>("/tasks") });

  const byDate = useMemo(() => {
    const map = new Map<string, OccurrenceDTO[]>();
    for (const o of cal.data?.occurrences ?? []) {
      if (taskFilter && o.taskId !== taskFilter) continue;
      if (personFilter && o.assigneeId !== personFilter) continue;
      map.set(o.date, [...(map.get(o.date) ?? []), o]);
    }
    return map;
  }, [cal.data, taskFilter, personFilter]);

  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  function shift(dir: -1 | 1) {
    const next = view === "week" ? addDays(anchor, dir * 7) : addMonthsClamped(`${anchor.slice(0, 8)}01`, dir);
    setAnchor(next);
    setSelected(view === "week" ? mondayOf(next) : next);
  }

  const title =
    view === "month"
      ? formatDate(`${anchor.slice(0, 8)}01`, { month: "long", year: "numeric" })
      : `${formatDate(from, { day: "numeric", month: "short" })} – ${formatDate(to, { day: "numeric", month: "short" })}`;
  const recurringTasks = (tasks.data ?? []).filter((t) => t.kind === "recurring" && !t.archivedAt);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Calendar</h1>

      <div className="flex items-center gap-2">
        <div className="flex rounded-xl bg-slate-100 p-1">
          {(["month", "week"] as const).map((v) => (
            <button key={v} className={`min-h-9 rounded-lg px-3 text-sm font-medium ${view === v ? "bg-white shadow" : "text-slate-600"}`} onClick={() => setView(v)} aria-pressed={view === v}>
              {v === "month" ? "Month" : "Week"}
            </button>
          ))}
        </div>
        <Button variant="ghost" className="ml-auto text-sm" onClick={() => (setAnchor(today), setSelected(today))}>
          Today
        </Button>
      </div>

      <div className="flex gap-2">
        <select className={`${inputClass} text-sm`} value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} aria-label="Filter by task">
          <option value="">All tasks</option>
          {recurringTasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className={`${inputClass} text-sm`} value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} aria-label="Filter by person">
          <option value="">Everyone</option>
          {memberList.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between">
        <button className="h-10 w-10 rounded-full text-xl active:bg-slate-200" onClick={() => shift(-1)} aria-label="Previous">
          ‹
        </button>
        <h2 className="font-semibold">{title}</h2>
        <button className="h-10 w-10 rounded-full text-xl active:bg-slate-200" onClick={() => shift(1)} aria-label="Next">
          ›
        </button>
      </div>
      <ErrorText error={cal.error} />

      {view === "month" ? (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
            {WEEKDAYS.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const items = byDate.get(d) ?? [];
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
              return (
                <button
                  key={d}
                  onClick={() => setSelected(d)}
                  aria-label={formatDate(d, { weekday: "long", day: "numeric", month: "long" })}
                  aria-pressed={selected === d}
                  className={`flex h-14 flex-col items-center rounded-lg pt-1 text-sm ${selected === d ? "bg-slate-900 text-white" : inMonth ? "bg-white" : "bg-transparent text-slate-400"} ${d === today && selected !== d ? "ring-2 ring-teal-600" : ""}`}
                >
                  {Number(d.slice(8))}
                  <span className="mt-1 flex flex-wrap justify-center gap-0.5 px-0.5">
                    {items.slice(0, 4).map((o) => (
                      <Dot key={o.id} occ={o} color={members.get(o.assigneeId)?.color} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <DayList date={selected} items={byDate.get(selected) ?? []} onOpen={setOpen} />
        </>
      ) : (
        <div className="space-y-3">
          {days.map((d) => (
            <DayList key={d} date={d} items={byDate.get(d) ?? []} onOpen={setOpen} highlight={d === today} />
          ))}
        </div>
      )}

      <Legend />
      <OccurrenceSheet occ={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Dot({ occ, color }: { occ: OccurrenceDTO; color?: string }) {
  const hollow = occ.status === "done" || occ.status === "missed";
  return (
    <span
      className="h-2 w-2 rounded-full"
      style={{ background: hollow ? "transparent" : color, border: `2px solid ${occ.status === "missed" ? "#dc2626" : color}`, opacity: occ.projected ? 0.5 : 1 }}
    />
  );
}

function DayList({ date, items, onOpen, highlight }: { date: string; items: OccurrenceDTO[]; onOpen: (o: OccurrenceDTO) => void; highlight?: boolean }) {
  const members = useMemberMap();
  return (
    <section>
      <h3 className={`mb-1 text-sm font-semibold ${highlight ? "text-teal-700" : "text-slate-500"}`}>{formatDate(date, { weekday: "long", day: "numeric", month: "long" })}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing scheduled</p>
      ) : (
        <ul className="space-y-1">
          {items.map((o) => {
            const m = members.get(o.assigneeId);
            return (
              <li key={o.id}>
                <button
                  onClick={() => onOpen(o)}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-white ${o.projected ? "opacity-60" : ""}`}
                  style={{ background: m?.color ?? "#64748b" }}
                >
                  <span className={`min-w-0 flex-1 truncate font-medium ${o.status === "done" ? "line-through opacity-80" : ""}`}>{o.taskName}</span>
                  <span className="text-xs opacity-90">
                    {m?.displayName}
                    {o.status === "done" && " · done"}
                    {o.status === "missed" && " · missed"}
                    {o.daysOverdue > 0 && " · overdue"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Legend() {
  const { data: members = [] } = useMembers();
  return (
    <div className="flex flex-wrap gap-3 pt-2 text-xs text-slate-600">
      {members.map((m) => (
        <span key={m.id} className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full" style={{ background: m.color }} /> {m.displayName}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-full border-2 border-slate-500" /> done
      </span>
    </div>
  );
}
