import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes } from "react-router";
import { useSession } from "./hooks";
import { SetupScreen } from "./screens/Setup";
import { JoinScreen } from "./screens/Join";
import { PairScreen } from "./screens/Pair";
import { SignedOutScreen } from "./screens/SignedOut";
import { TodayScreen } from "./screens/Today";
import { TasksScreen } from "./screens/Tasks";
import { TaskFormScreen } from "./screens/TaskForm";
import { HistoryScreen } from "./screens/History";
import { SettingsScreen } from "./screens/Settings";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/setup" element={<SetupScreen />} />
          <Route path="/join/:token" element={<JoinScreen />} />
          <Route path="/pair" element={<PairScreen />} />
          <Route element={<SignedInShell />}>
            <Route index element={<TodayScreen />} />
            <Route path="tasks" element={<TasksScreen />} />
            <Route path="tasks/new" element={<TaskFormScreen />} />
            <Route path="history" element={<HistoryScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

const tabs = [
  { to: "/", label: "Today", icon: "☀️" },
  { to: "/tasks", label: "Tasks", icon: "📋" },
  { to: "/history", label: "History", icon: "🕘" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

function SignedInShell() {
  const { data, isLoading, error } = useSession();
  if (isLoading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-700">Can't reach the server. Check your connection.</div>;
  if (data?.setupNeeded) return <Navigate to="/setup" replace />;
  if (!data?.me) return <SignedOutScreen />;
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <main className="px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto flex max-w-md">
          {tabs.map((t) => (
            <li key={t.to} className="flex-1">
              <NavLink
                to={t.to}
                end={t.to === "/"}
                className={({ isActive }) => `flex flex-col items-center py-2 text-xs ${isActive ? "font-semibold text-teal-700" : "text-slate-500"}`}
              >
                <span className="text-xl" aria-hidden>
                  {t.icon}
                </span>
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
