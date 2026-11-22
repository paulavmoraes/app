import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useMe, useMemberMap, useMembers, useSwaps } from "../hooks";
import { formatDate, overdueLabel, relativeTime } from "../format";
import type { OccurrenceDTO, TodayDTO } from "../../shared/types";
import { Avatar, Button, Card, Empty, ErrorText, Sheet, Toast } from "../components/ui";

type ToastState = { message: string; undo?: () => Promise<unknown> } | null;

export function TodayScreen() {
  const qc = useQueryClient();
  const me = useMe();
  const memberMap = useMemberMap();
  const [params, setParams] = useSearchParams();
  const today = useQuery({ queryKey: ["today"], queryFn: () => api.get<TodayDTO>("/today") });
  const [completing, setCompleting] = useState<OccurrenceDTO | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const refresh = () => qc.invalidateQueries();
  const swaps = useSwaps();
  const incoming = (swaps.data ?? []).filter((s) => s.toMemberId === me.id);
  const outgoing = (swaps.data ?? []).filter((s) => s.fromMemberId === me.id);

  async function answer(swapId: string, action: "accept" | "decline" | "cancel") {
    try {
      await api.post(`/swaps/${swapId}/${action}`);
      setToast({ message: action === "accept" ? "Swap accepted: it's yours now" : action === "decline" ? "Swap declined" : "Request cancelled" });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Something went wrong" });
    }
    await refresh();
  }

  async function tick(taskId: string, name: string) {
    const { id } = await api.post<{ id: string }>(`/quick/${taskId}/tick`);
    await refresh();
    setToast({ message: `Logged: ${name}`, undo: () => api.del(`/quick/ticks/${id}`) });
  }

  const d = today.data;
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">{d ? formatDate(d.today, { weekday: "long", day: "numeric", month: "long" }) : ""}</p>
        <h1 className="text-2xl font-semibold">Hi {me.displayName}</h1>
      </header>

      {params.get("welcome") && (
        <Card className="bg-teal-50! ring-teal-200!">
          <p className="font-medium">You're in! 🎉</p>
          <p className="mt-1 text-sm text-slate-700">
            Add this app to your home screen: on iPhone tap <b>Share → Add to Home Screen</b>. Then open it from the home screen and sign in
            with a pairing code from <b>Settings</b> (iPhone keeps the home-screen app separate from Safari).
          </p>
          <Button variant="ghost" className="mt-2 -ml-4" onClick={() => setParams({})}>
            Got it
          </Button>
        </Card>
      )}

      <ErrorText error={today.error} />

      {(incoming.length > 0 || outgoing.length > 0) && (
        <section>
          <h2 className="mb-2 font-semibold">Swap requests</h2>
          <div className="space-y-2">
            {incoming.map((s) => (
              <Card key={s.id} className="space-y-3 bg-amber-50! ring-amber-200!">
                <p>
                  <b>{memberMap.get(s.fromMemberId)?.displayName}</b> asks you to take <b>{s.occurrence.taskName}</b> on {formatDate(s.occurrence.date)}.
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => answer(s.id, "decline")}>
                    Decline
                  </Button>
                  <Button className="flex-1" onClick={() => answer(s.id, "accept")}>
                    Accept
                  </Button>
                </div>
              </Card>
            ))}
            {outgoing.map((s) => (
              <Card key={s.id} className="flex items-center gap-3">
                <p className="min-w-0 flex-1 text-sm text-slate-600">
                  Waiting for {memberMap.get(s.toMemberId)?.displayName}: {s.occurrence.taskName}, {formatDate(s.occurrence.date)}
                </p>
                <Button variant="ghost" className="text-sm" onClick={() => answer(s.id, "cancel")}>
                  Cancel
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      {d && d.owedShifts > 0 && (
        <Card className="bg-red-50! text-sm ring-red-200!">
          You owe {d.owedShifts} extra shift{d.owedShifts === 1 ? "" : "s"}. {d.owedShifts === 1 ? "It" : "They"}'ll be assigned as soon as someone else has a task coming up.
        </Card>
      )}

      {d && d.overdue.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-red-700">Overdue</h2>
          <div className="space-y-2">
            {d.overdue.map((o) => (
              <OccurrenceRow key={o.id} occ={o} subtitle={overdueLabel(o.daysOverdue)} danger onDone={() => setCompleting(o)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Due today</h2>
        {d && d.dueToday.length === 0 && <Empty>Nothing due for you today. 🌿</Empty>}
        <div className="space-y-2">
          {d?.dueToday.map((o) => <OccurrenceRow key={o.id} occ={o} onDone={() => setCompleting(o)} />)}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Quick ticks</h2>
        {d && d.quick.length === 0 && <Empty>No quick ticks yet. Add some in Tasks.</Empty>}
        <div className="grid grid-cols-2 gap-2">
          {d?.quick.map((q) => {
            const who = q.last ? memberMap.get(q.last.memberId) : undefined;
            return (
              <button
                key={q.taskId}
                onClick={() => tick(q.taskId, q.name)}
                className="rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 active:bg-teal-50"
              >
                <span className="block font-medium">{q.name}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {q.last ? `${relativeTime(q.last.at)} · ${who?.displayName ?? "someone"}` : "Never done"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <CompleteSheet
        occ={completing}
        onClose={() => setCompleting(null)}
        onCompleted={(o) => {
          setCompleting(null);
          setToast({ message: `Done: ${o.taskName}`, undo: () => api.post(`/occurrences/${o.id}/undo`) });
        }}
      />

      {toast && (
        <Toast
          message={toast.message}
          action={toast.undo ? "Undo" : undefined}
          onAction={async () => {
            const undo = toast.undo;
            setToast(null);
            try {
              await undo?.();
            } catch (err) {
              setToast({ message: err instanceof Error ? err.message : "Couldn't undo" });
            }
            await refresh();
          }}
          onDone={clearToast}
        />
      )}
    </div>
  );
}

function OccurrenceRow({ occ, subtitle, danger, onDone }: { occ: OccurrenceDTO; subtitle?: string; danger?: boolean; onDone: () => void }) {
  return (
    <Card className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{occ.taskName}</p>
        <p className={`text-sm ${danger ? "text-red-700" : "text-slate-500"}`}>
          {subtitle ?? formatDate(occ.date)}
          {occ.override === "away_cover" && " · covering"}
          {occ.override === "penalty" && " · extra shift"}
          {occ.override === "swap" && " · swapped"}
        </p>
      </div>
      <Button onClick={onDone} aria-label={`Mark ${occ.taskName} done`}>
        Done
      </Button>
    </Card>
  );
}

export function CompleteSheet({ occ, onClose, onCompleted }: { occ: OccurrenceDTO | null; onClose: () => void; onCompleted: (o: OccurrenceDTO) => void }) {
  const me = useMe();
  const { data: members = [] } = useMembers();
  const qc = useQueryClient();
  const [doneBy, setDoneBy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const selected = doneBy ?? me.id;

  async function confirm() {
    if (!occ) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/occurrences/${occ.id}/complete`, { doneById: selected });
      await qc.invalidateQueries();
      setDoneBy(null);
      onCompleted(occ);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!occ} onClose={onClose} title={occ ? `Done: ${occ.taskName}` : ""}>
      <p className="mb-2 text-sm text-slate-600">Done by</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => setDoneBy(m.id)}
            className={`flex min-h-11 items-center gap-2 rounded-full px-3 ring-1 ${selected === m.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white ring-slate-300"}`}
            aria-pressed={selected === m.id}
          >
            <Avatar member={m} size={24} />
            {m.id === me.id ? "Me" : m.displayName}
          </button>
        ))}
      </div>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={confirm} disabled={busy}>
          Mark done
        </Button>
      </div>
    </Sheet>
  );
}
