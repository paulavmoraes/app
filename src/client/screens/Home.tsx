import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useMe, useMemberMap } from "../hooks";
import { formatDate, overdueLabel } from "../format";
import type { HomeDTO, OccurrenceDTO } from "../../shared/types";
import { Avatar, Empty, ErrorText } from "../components/ui";
import { OccurrenceSheet } from "../components/OccurrenceSheet";

export function HomeScreen() {
  const me = useMe();
  const members = useMemberMap();
  const { data, error } = useQuery({ queryKey: ["home"], queryFn: () => api.get<HomeDTO>("/home") });
  const [open, setOpen] = useState<OccurrenceDTO | null>(null);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Home</h1>
      <ErrorText error={error} />
      {data?.groups.map((g) => {
        const m = members.get(g.memberId);
        return (
          <section key={g.memberId}>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <Avatar member={m} size={26} /> {m?.id === me.id ? "Me" : m?.displayName}
            </h2>
            {g.items.length === 0 ? <Empty>Nothing coming up.</Empty> : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200" style={{ borderLeft: `4px solid ${m?.color}` }}>
              {g.items.map((o) => (
                <li key={o.id}>
                  <button className="flex w-full items-center gap-3 p-3 text-left active:bg-slate-50" onClick={() => setOpen(o)}>
                    <span className="min-w-0 flex-1 truncate font-medium">{o.taskName}</span>
                    <span className={`text-sm ${o.daysOverdue > 0 ? "text-red-700" : o.date === data.today ? "font-medium text-teal-700" : "text-slate-500"}`}>
                      {o.daysOverdue > 0 ? overdueLabel(o.daysOverdue) : o.date === data.today ? "Today" : formatDate(o.date)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            )}
          </section>
        );
      })}
      <OccurrenceSheet occ={open} onClose={() => setOpen(null)} />
    </div>
  );
}
