import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskDTO } from "../../shared/types";
import { api } from "../api";
import { useMemberMap, useMembers } from "../hooks";
import { formatDate, londonDate, WEEKDAYS } from "../format";
import type { Schedule, IntervalUnit } from "../../domain/schedule";
import type { Assignment } from "../../domain/assign";
import { initialState } from "../../domain/assign";
import { generateSeries, nextCompletionOccurrence } from "../../domain/generate";
import { hasFixedSeries } from "../../domain/schedule";
import { addDays } from "../../domain/dates";
import { Avatar, Button, Card, ErrorText, Field, inputClass } from "../components/ui";

type Kind = "recurring" | "quick";

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-lg text-sm font-medium ${value === o.value ? "bg-white shadow" : "text-slate-600"}`}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TaskFormScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: members = [] } = useMembers();
  const memberMap = useMemberMap();
  const [today] = useState(() => londonDate(new Date().toISOString()));

  const [kind, setKind] = useState<Kind>("recurring");
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<"weekdays" | "interval">("weekdays");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [n, setN] = useState(1);
  const [unit, setUnit] = useState<IntervalUnit>("week");
  const [anchor, setAnchor] = useState<"schedule" | "completion">("schedule");
  const [startDate, setStartDate] = useState(today);
  const [mode, setMode] = useState<"fixed" | "rotation">("rotation");
  const [fixedId, setFixedId] = useState<string>("");
  const [order, setOrder] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Edit mode: prefill from the task's current version.
  const { id } = useParams();
  const editing = !!id;
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => api.get<TaskDTO[]>("/tasks"), enabled: editing });
  const original = tasks.data?.find((t) => t.id === id);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!original || loaded) return;
    setLoaded(true);
    setKind(original.kind);
    setName(original.name);
    const s = original.schedule;
    if (s) {
      setScheduleType(s.type);
      if (s.type === "weekdays") {
        setWeekdays(s.weekdays);
        setStartDate(s.startDate > today ? s.startDate : today);
      } else {
        setN(s.n);
        setUnit(s.unit);
        setAnchor(s.anchor);
        setStartDate(s.startDate);
      }
    }
    const a = original.assignment;
    if (a?.mode === "fixed") {
      setMode("fixed");
      setFixedId(a.memberId);
    } else if (a) {
      setMode("rotation");
      setOrder(a.order);
    }
  }, [original, loaded, today]);

  const rotation = order ?? members.map((m) => m.id);
  const fixed = fixedId || members[0]?.id || "";

  const schedule: Schedule =
    scheduleType === "weekdays" ? { type: "weekdays", weekdays, startDate } : { type: "interval", n, unit, anchor, startDate };
  const assignment: Assignment = mode === "fixed" ? { mode: "fixed", memberId: fixed } : { mode: "rotation", order: rotation };
  const valid = name.trim() && (kind === "quick" || ((scheduleType === "interval" || weekdays.length > 0) && (mode === "fixed" ? fixed : rotation.length > 0)));

  const serverPreview = useQuery({
    queryKey: ["preview", id, JSON.stringify(schedule), JSON.stringify(assignment)],
    queryFn: () => api.post<{ date: string; assigneeId: string }[]>(`/tasks/${id}/preview`, { schedule, assignment }),
    enabled: editing && loaded && kind === "recurring" && !!valid,
    placeholderData: (prev) => prev,
  });

  const localPreview = useMemo(() => {
    if (editing || kind !== "recurring" || !valid) return [];
    const ctx = { members: members.map((m) => m.id), isAway: () => false };
    if (hasFixedSeries(schedule)) {
      return generateSeries(schedule, assignment, initialState(assignment), startDate, addDays(startDate, 800), ctx).occurrences.slice(0, 6);
    }
    if (schedule.type !== "interval") return [];
    // From completion: show the first due date, then assume each is done on time.
    const out = [];
    let state = initialState(assignment);
    let after: string | null = null;
    for (let i = 0; i < 6; i++) {
      const g = nextCompletionOccurrence(schedule, assignment, state, after, ctx);
      out.push(g);
      state = g.stateAfter;
      after = g.date;
    }
    return out;
  }, [editing, kind, valid, JSON.stringify(schedule), JSON.stringify(assignment), members]);
  const preview = editing ? (serverPreview.data ?? []) : localPreview;

  function move(i: number, dir: -1 | 1) {
    const next = [...rotation];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }

  function toggleInRotation(id: string) {
    setOrder(rotation.includes(id) ? rotation.filter((x) => x !== id) : [...rotation, id]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.patch(`/tasks/${id}`, kind === "quick" ? { name } : { name, schedule, assignment });
      else await api.post("/tasks", kind === "quick" ? { kind, name } : { kind, name, schedule, assignment });
      await qc.invalidateQueries();
      navigate("/tasks");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <header className="flex items-center gap-2">
        <Button type="button" variant="ghost" className="-ml-4" onClick={() => navigate(-1)}>
          ‹ Back
        </Button>
        <h1 className="text-2xl font-semibold">{editing ? "Edit task" : "New task"}</h1>
      </header>

      {editing && kind === "recurring" && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Changes apply from today. Past and overdue occurrences keep their date and person. The rotation carries on with whoever is next up.
        </p>
      )}

      {!editing && (
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "recurring", label: "Recurring" },
          { value: "quick", label: "Quick tick" },
        ]}
      />
      )}

      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder={kind === "quick" ? "Take out the bins" : "Clean the microwave"} />
      </Field>

      {kind === "quick" && <p className="text-sm text-slate-600">No schedule or assignee. Anyone taps it to log who did it and when.</p>}

      {kind === "recurring" && (
        <>
          <Field label="Schedule">
            <Segmented
              value={scheduleType}
              onChange={setScheduleType}
              options={[
                { value: "weekdays", label: "Fixed weekdays" },
                { value: "interval", label: "Interval" },
              ]}
            />
          </Field>

          {scheduleType === "weekdays" ? (
            <div className="flex justify-between gap-1" role="group" aria-label="Weekdays">
              {WEEKDAYS.map((label, i) => {
                const on = weekdays.includes(i);
                return (
                  <button
                    type="button"
                    key={label}
                    onClick={() => setWeekdays(on ? weekdays.filter((d) => d !== i) : [...weekdays, i])}
                    className={`h-11 flex-1 rounded-xl text-sm font-medium ring-1 ${on ? "bg-teal-700 text-white ring-teal-700" : "bg-white ring-slate-300"}`}
                    aria-pressed={on}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span>Every</span>
                <input type="number" min={1} max={366} className={`${inputClass} w-20`} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value)))} aria-label="Interval" />
                <select className={`${inputClass} flex-1`} value={unit} onChange={(e) => setUnit(e.target.value as IntervalUnit)} aria-label="Unit">
                  <option value="day">day(s)</option>
                  <option value="week">week(s)</option>
                  <option value="month">month(s)</option>
                </select>
              </div>
              <Field label="Count the next one from">
                <Segmented
                  value={anchor}
                  onChange={setAnchor}
                  options={[
                    { value: "schedule", label: "Scheduled date" },
                    { value: "completion", label: "Last completion" },
                  ]}
                />
              </Field>
              <p className="text-sm text-slate-600">
                {anchor === "schedule"
                  ? "Dates stay fixed: being late doesn't push the next one out. If one isn't done before the next is due, it's marked missed."
                  : "The next one is due a full interval after it's actually done. It's never marked missed; it just stays overdue."}
              </p>
            </>
          )}

          {!(editing && scheduleType === "interval" && anchor === "completion") && (
          <Field label={scheduleType === "weekdays" ? "Starting from" : anchor === "schedule" ? "Series starts on (dates repeat from here)" : "First due date"}>
            <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
          )}

          <Field label="Who does it">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "rotation", label: "Rotation" },
                { value: "fixed", label: "Always the same person" },
              ]}
            />
          </Field>

          {mode === "fixed" ? (
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => setFixedId(m.id)}
                  className={`flex min-h-11 items-center gap-2 rounded-full px-3 ring-1 ${fixed === m.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white ring-slate-300"}`}
                  aria-pressed={fixed === m.id}
                >
                  <Avatar member={m} size={24} /> {m.displayName}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                {editing
                  ? "Order of the rotation. It moves to the next person on every occurrence; whoever is next up now stays next up."
                  : "Order of the rotation (first person starts). It moves to the next person on every occurrence."}
              </p>
              {rotation.map((id, i) => (
                <div key={id} className="flex items-center gap-2 rounded-xl bg-white p-2 ring-1 ring-slate-200">
                  <span className="w-5 text-center text-sm text-slate-500">{i + 1}</span>
                  <Avatar member={memberMap.get(id)} size={24} />
                  <span className="flex-1">{memberMap.get(id)?.displayName}</span>
                  <button type="button" className="h-9 w-9 rounded-lg ring-1 ring-slate-300" onClick={() => move(i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className="h-9 w-9 rounded-lg ring-1 ring-slate-300" onClick={() => move(i, 1)} aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" className="h-9 w-9 rounded-lg ring-1 ring-slate-300" onClick={() => toggleInRotation(id)} aria-label="Remove from rotation">
                    ✕
                  </button>
                </div>
              ))}
              {members
                .filter((m) => !rotation.includes(m.id))
                .map((m) => (
                  <Button type="button" variant="secondary" key={m.id} onClick={() => toggleInRotation(m.id)}>
                    + Add {m.displayName}
                  </Button>
                ))}
            </div>
          )}

          {preview.length > 0 && (
            <Card>
              <p className="mb-2 text-sm font-medium text-slate-700">Next occurrences</p>
              <ul className="space-y-1">
                {preview.map((p) => (
                  <li key={p.date} className="flex items-center gap-2 text-sm">
                    <Avatar member={memberMap.get(p.assigneeId)} size={20} />
                    <span className="w-28">{formatDate(p.date)}</span>
                    <span className="text-slate-600">{memberMap.get(p.assigneeId)?.displayName}</span>
                  </li>
                ))}
              </ul>
              {schedule.type === "interval" && schedule.anchor === "completion" && (
                <p className="mt-2 text-xs text-slate-500">
                  {editing ? "Counted from the last completion, assuming each one is done on its due date. An overdue one stays as it is." : "Assuming each one is done on its due date."}
                </p>
              )}
            </Card>
          )}
        </>
      )}

      <ErrorText error={error} />
      <Button className="w-full" disabled={busy || !valid || (editing && !loaded)}>
        {editing ? "Save changes" : "Create"}
      </Button>
    </form>
  );
}
