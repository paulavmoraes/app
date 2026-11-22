import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useMemberMap } from "../hooks";
import { describeAssignment, describeSchedule } from "../describe";
import type { TaskDTO } from "../../shared/types";
import { Button, Card, Empty, ErrorText } from "../components/ui";

export function TasksScreen() {
  const qc = useQueryClient();
  const members = useMemberMap();
  const { data, error } = useQuery({ queryKey: ["tasks"], queryFn: () => api.get<TaskDTO[]>("/tasks") });
  const active = (data ?? []).filter((t) => !t.archivedAt);
  const recurring = active.filter((t) => t.kind === "recurring");
  const quick = active.filter((t) => t.kind === "quick");

  async function archive(t: TaskDTO) {
    if (!confirm(`Archive "${t.name}"? Its history is kept; upcoming occurrences are removed.`)) return;
    await api.post(`/tasks/${t.id}/archive`);
    await qc.invalidateQueries();
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <Link to="/tasks/new">
          <Button>+ New</Button>
        </Link>
      </header>
      <ErrorText error={error} />

      <section>
        <h2 className="mb-2 font-semibold">Recurring</h2>
        {data && recurring.length === 0 && <Empty>No recurring tasks yet.</Empty>}
        <div className="space-y-2">
          {recurring.map((t) => (
            <Card key={t.id} className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.name}</p>
                <p className="text-sm text-slate-500">{t.schedule && describeSchedule(t.schedule)}</p>
                <p className="text-sm text-slate-500">{t.assignment && describeAssignment(t.assignment, members)}</p>
              </div>
              <div className="flex flex-col">
                <Link to={`/tasks/${t.id}/edit`}>
                  <Button variant="ghost" className="text-sm">
                    Edit
                  </Button>
                </Link>
                <Button variant="ghost" className="text-sm" onClick={() => archive(t)}>
                  Archive
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Quick ticks</h2>
        {data && quick.length === 0 && <Empty>No quick ticks yet.</Empty>}
        <div className="space-y-2">
          {quick.map((t) => (
            <Card key={t.id} className="flex items-center gap-3">
              <p className="flex-1 font-medium">{t.name}</p>
              <Link to={`/tasks/${t.id}/edit`}>
                <Button variant="ghost" className="text-sm">
                  Rename
                </Button>
              </Link>
              <Button variant="ghost" className="text-sm" onClick={() => archive(t)}>
                Archive
              </Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
