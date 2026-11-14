import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useMe, useMemberMap, useMembers, useSwaps } from "../hooks";
import { formatDate, overdueLabel } from "../format";
import type { OccurrenceDTO } from "../../shared/types";
import { Avatar, Button, ErrorText, Sheet } from "./ui";
import { CompleteSheet } from "../screens/Today";

/** Details for one occurrence, with Done. Used by Home and Calendar. */
export function OccurrenceSheet({ occ, onClose, onCompleted }: { occ: OccurrenceDTO | null; onClose: () => void; onCompleted?: (o: OccurrenceDTO) => void }) {
  const members = useMemberMap();
  const me = useMe();
  const qc = useQueryClient();
  const { data: memberList = [] } = useMembers();
  const swaps = useSwaps();
  const [completing, setCompleting] = useState<OccurrenceDTO | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const close = () => {
    setChoosing(false);
    setError(null);
    onClose();
  };

  async function swapAction(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setChoosing(false);
    } catch (err) {
      setError(err);
    }
    await qc.invalidateQueries();
  }

  if (completing) {
    return (
      <CompleteSheet
        occ={completing}
        onClose={() => setCompleting(null)}
        onCompleted={(o) => {
          setCompleting(null);
          onClose();
          onCompleted?.(o);
        }}
      />
    );
  }
  if (!occ) return null;
  const assignee = members.get(occ.assigneeId);
  const doneBy = occ.completedById ? members.get(occ.completedById) : undefined;
  const pendingSwap = swaps.data?.find((s) => s.occurrence.id === occ.id);
  const canSwap = occ.status === "pending" && !occ.projected && occ.assigneeId === me.id && !pendingSwap;
  return (
    <Sheet open onClose={close} title={occ.taskName}>
      <dl className="mb-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">Date</dt>
          <dd>{formatDate(occ.date, { weekday: "long", day: "numeric", month: "long" })}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Assigned to</dt>
          <dd className="flex items-center gap-2">
            <Avatar member={assignee} size={22} /> {assignee?.displayName}
            {occ.override === "away_cover" && <span className="text-slate-500">(covering)</span>}
            {occ.override === "swap" && <span className="text-slate-500">(swapped)</span>}
            {occ.override === "penalty" && <span className="text-slate-500">(extra shift)</span>}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Status</dt>
          <dd>
            {occ.status === "done" && `Done by ${doneBy?.displayName ?? "someone"}`}
            {occ.status === "missed" && "Missed"}
            {occ.status === "pending" && (occ.daysOverdue > 0 ? <span className="text-red-700">{overdueLabel(occ.daysOverdue)}</span> : occ.projected ? "Planned" : "To do")}
          </dd>
        </div>
      </dl>

      {pendingSwap && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
          {pendingSwap.fromMemberId === me.id ? (
            <div className="flex items-center justify-between gap-2">
              <span>Waiting for {members.get(pendingSwap.toMemberId)?.displayName} to answer your swap request.</span>
              <Button variant="secondary" className="shrink-0 text-sm" onClick={() => swapAction(() => api.post(`/swaps/${pendingSwap.id}/cancel`))}>
                Cancel request
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p>{members.get(pendingSwap.fromMemberId)?.displayName} asks you to take this one.</p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => swapAction(() => api.post(`/swaps/${pendingSwap.id}/decline`))}>
                  Decline
                </Button>
                <Button className="flex-1" onClick={() => swapAction(() => api.post(`/swaps/${pendingSwap.id}/accept`))}>
                  Accept
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {choosing && (
        <div className="mb-4">
          <p className="mb-2 text-sm text-slate-600">Ask who to take this one? Only this date changes; the rotation stays the same.</p>
          <div className="flex flex-wrap gap-2">
            {memberList
              .filter((m) => m.id !== me.id)
              .map((m) => (
                <button
                  key={m.id}
                  className="flex min-h-11 items-center gap-2 rounded-full bg-white px-3 ring-1 ring-slate-300 active:bg-slate-100"
                  onClick={() => swapAction(() => api.post("/swaps", { occurrenceId: occ.id, toMemberId: m.id }))}
                >
                  <Avatar member={m} size={24} /> Ask {m.displayName}
                </button>
              ))}
          </div>
        </div>
      )}
      <ErrorText error={error} />

      {canSwap && !choosing && (
        <Button variant="secondary" className="mb-2 w-full" onClick={() => setChoosing(true)}>
          Propose swap
        </Button>
      )}
      <div className="flex gap-2">
        <Link to={`/tasks/${occ.taskId}/edit`} className="flex-1">
          <Button variant="secondary" className="w-full">
            Edit task
          </Button>
        </Link>
        {occ.status === "pending" && !occ.projected && (
          <Button className="flex-1" onClick={() => setCompleting(occ)}>
            Mark done
          </Button>
        )}
      </div>
    </Sheet>
  );
}
