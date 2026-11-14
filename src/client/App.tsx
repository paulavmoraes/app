import { useEffect, useState } from "react";

export function App() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<{ ok: boolean }>)
      .then((d) => setOk(d.ok))
      .catch(() => setOk(false));
  }, []);
  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-2xl font-semibold">Chores</h1>
      <p className="mt-2 text-slate-600">API: {ok === null ? "…" : ok ? "ok" : "unreachable"}</p>
    </main>
  );
}
