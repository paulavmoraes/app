import { useState } from "react";
import { Link } from "react-router";
import { useMemberMap } from "../hooks";
import { formatDate, overdueLabel } from "../format";
import type { OccurrenceDTO } from "../../shared/types";
import { Avatar, Button, Sheet } from "./ui";
import { CompleteSheet } from "../screens/Today";

/** Details for one occurrence, with Done. Used by Home and Calendar. */
export function OccurrenceSheet({ occ, onClose, onCompleted }: { occ: OccurrenceDTO | null; onClose: () => void; onCompleted?: (o: OccurrenceDTO) => void }) {
  const members = useMemberMap();
  const [completing, setCompleting] = useState<OccurrenceDTO | null>(null);
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
  return (
    <Sheet open onClose={onClose} title={occ.taskName}>
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
