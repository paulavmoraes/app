import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useInbox } from "../hooks";
import { relativeTime } from "../format";
import { canPromptInstall, currentSubscription, disablePush, enablePush, isIOS, isStandalone, onInstallAvailable, promptInstall, pushSupported } from "../push";
import { Button, Card, Empty, ErrorText } from "../components/ui";

const ICONS: Record<string, string> = {
  daily_summary: "☀️",
  swap_proposed: "⇄",
  swap_accepted: "✅",
  swap_declined: "🚫",
  missed: "❌",
  penalty: "➕",
  penalty_freed: "🎈",
};

export function NotificationsScreen() {
  const qc = useQueryClient();
  const inbox = useInbox();
  // Remember what was unread when the screen opened, so new items stay highlighted while it's marked read.
  const [unreadIds, setUnreadIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!inbox.data || unreadIds) return;
    setUnreadIds(new Set(inbox.data.items.filter((i) => !i.readAt).map((i) => i.id)));
    if (inbox.data.unread > 0) api.post("/notifications/read").then(() => qc.invalidateQueries({ queryKey: ["inbox"] }));
  }, [inbox.data, unreadIds, qc]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <PushCard />
      <ErrorText error={inbox.error} />
      {inbox.data && inbox.data.items.length === 0 && <Empty>No notifications yet. The daily summary arrives at 9:00.</Empty>}
      <ul className="space-y-2">
        {inbox.data?.items.map((n) => (
          <li key={n.id} className={`flex gap-3 rounded-2xl bg-white p-3 ring-1 ${unreadIds?.has(n.id) ? "ring-2 ring-teal-600" : "ring-slate-200"}`}>
            <span className="text-xl" aria-hidden>
              {ICONS[n.type] ?? "🔔"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{n.title}</p>
              <p className="text-sm whitespace-pre-line text-slate-600">{n.body}</p>
              <p className="mt-1 text-xs text-slate-400">{relativeTime(n.createdAt)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Turning push on for this device, with install guidance where the phone requires it first. */
function PushCard() {
  const installable = useSyncExternalStore(onInstallAvailable, canPromptInstall);
  const sub = useQuery({ queryKey: ["pushSub"], queryFn: async () => (await currentSubscription())?.endpoint ?? null, staleTime: 0 });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setTestResult("");
    try {
      await fn();
    } catch (err) {
      setError(err);
    }
    setBusy(false);
    await sub.refetch();
  }

  const installCard = installable && !isStandalone() && (
    <Button variant="secondary" className="w-full" onClick={() => promptInstall()}>
      Install the app
    </Button>
  );

  if (isIOS() && !isStandalone()) {
    return (
      <Card className="space-y-2 text-sm">
        <p className="font-medium">Get notifications on your iPhone</p>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li>
            In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>.
          </li>
          <li>Open Chores from your home screen.</li>
          <li>
            Sign in there with a pairing code (get one here under your avatar → <b>Pairing code</b>).
          </li>
          <li>
            Come back to this tab in the installed app and tap <b>Turn on notifications</b>.
          </li>
        </ol>
        <p className="text-slate-500">Needs iOS 16.4 or later.</p>
      </Card>
    );
  }
  if (!pushSupported()) {
    return (
      <Card className="space-y-2 text-sm text-slate-600">
        <p>This browser doesn't support push notifications. You'll still see everything in this list.</p>
        {installCard}
      </Card>
    );
  }
  if (sub.data) {
    return (
      <Card className="space-y-3 text-sm">
        <p className="font-medium text-teal-800">✓ Notifications are on for this device</p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.post<{ sent: number; failed: number }>("/push/test");
                setTestResult(r.sent > 0 ? "Sent. It should arrive in a few seconds." : "Couldn't send. Try turning notifications off and on again.");
              })
            }
          >
            Send a test
          </Button>
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => run(disablePush)}>
            Turn off
          </Button>
        </div>
        {testResult && <p className="text-slate-600">{testResult}</p>}
        <ErrorText error={error} />
        {installCard}
      </Card>
    );
  }
  return (
    <Card className="space-y-3 text-sm">
      <p>Get the 9:00 daily summary and swap requests as notifications on this device.</p>
      <Button className="w-full" disabled={busy} onClick={() => run(enablePush)}>
        Turn on notifications
      </Button>
      <ErrorText error={error} />
      {installCard}
    </Card>
  );
}
