import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAway, useMe, useMembers, useSession } from "../hooks";
import { formatDate, londonDate } from "../format";
import { addDays } from "../../domain/dates";
import { MEMBER_COLORS } from "../../shared/colors";
import { Avatar, Button, Card, ColorPicker, ErrorText, Field, inputClass } from "../components/ui";

async function share(url: string, title: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch {
      /* cancelled: fall through to copy */
    }
  }
  await navigator.clipboard?.writeText(url).catch(() => undefined);
  return "copied";
}

export function SettingsScreen() {
  const me = useMe();
  const session = useSession();
  const { data: members = [] } = useMembers();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [color, setColor] = useState(me.color);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const available = useQuery({ queryKey: ["colors"], queryFn: () => api.get<string[]>("/colors/available") });
  const choosable = MEMBER_COLORS.filter((c) => c === me.color || available.data?.includes(c));

  useEffect(() => setSaved(false), [displayName, color]);

  const away = useAway();
  const myAway = (away.data ?? []).filter((p) => p.memberId === me.id);
  const todayDate = londonDate(new Date().toISOString());
  const [awayStart, setAwayStart] = useState(todayDate);
  const [awayEnd, setAwayEnd] = useState(addDays(todayDate, 7));
  const [awayError, setAwayError] = useState<unknown>(null);

  async function addAway(e: React.FormEvent) {
    e.preventDefault();
    setAwayError(null);
    try {
      await api.post("/away", { startDate: awayStart, endDate: awayEnd });
    } catch (err) {
      setAwayError(err);
    }
    await qc.invalidateQueries();
  }

  async function removeAway(id: string) {
    if (!confirm("Remove this away period? Your shifts in it come back to you.")) return;
    await api.del(`/away/${id}`);
    await qc.invalidateQueries();
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.patch("/me", { displayName, color });
      await qc.invalidateQueries();
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  async function createLink(kind: "join" | "device", memberId?: string, label = "Invite link") {
    setError(null);
    try {
      const { url } = await api.post<{ url: string }>("/invites", kind === "join" ? { kind } : { kind, memberId });
      setLink({ label, url });
    } catch (err) {
      setError(err);
    }
  }

  async function createCode() {
    setCode(await api.post<{ code: string; expiresAt: string }>("/pairing-code"));
  }

  async function logout() {
    if (!confirm("Sign out on this device?")) return;
    await api.post("/logout");
    await qc.invalidateQueries();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ErrorText error={error} />

      <Card>
        <form onSubmit={saveProfile} className="space-y-4">
          <h2 className="font-semibold">Your profile</h2>
          <Field label="Display name">
            <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={30} required />
          </Field>
          <Field label="Colour">
            <ColorPicker colors={choosable} value={color} onChange={setColor} />
          </Field>
          <Button>{saved ? "Saved ✓" : "Save"}</Button>
        </form>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">{session.data?.household?.name ?? "Household"}</h2>
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <Avatar member={m} size={28} />
              <span className="flex-1">{m.displayName}</span>
              <Button variant="ghost" className="text-sm" onClick={() => createLink("device", m.id, `Sign-in link for ${m.displayName}`)}>
                New device link
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="secondary" className="w-full" onClick={() => createLink("join")}>
          Invite a flatmate
        </Button>
        {link && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <p className="text-sm font-medium">{link.label} (single use, valid 7 days)</p>
            <input className={`${inputClass} text-sm`} readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Link" />
            <Button className="w-full" onClick={async () => alert((await share(link.url, link.label)) === "copied" ? "Link copied" : "Shared")}>
              Share link
            </Button>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Away mode</h2>
        <p className="text-sm text-slate-600">
          For longer trips (more than 5 days). While you're away the rotation skips you, the others cover your shifts, and you get no penalties or notifications. Nothing is owed when you're back.
        </p>
        {myAway.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3">
            <span className="flex-1">
              {formatDate(p.startDate)} – {formatDate(p.endDate)}
            </span>
            <Button variant="ghost" className="text-sm" onClick={() => removeAway(p.id)}>
              Remove
            </Button>
          </div>
        ))}
        <form onSubmit={addAway} className="space-y-3">
          <div className="flex gap-2">
            <Field label="From">
              <input type="date" className={inputClass} value={awayStart} onChange={(e) => setAwayStart(e.target.value)} required />
            </Field>
            <Field label="Until (inclusive)">
              <input type="date" className={inputClass} value={awayEnd} min={awayStart} onChange={(e) => setAwayEnd(e.target.value)} required />
            </Field>
          </div>
          <ErrorText error={awayError} />
          <Button variant="secondary" className="w-full">
            Set away
          </Button>
        </form>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Pairing code</h2>
        <p className="text-sm text-slate-600">
          Installed the app on your iPhone home screen? It doesn't share your Safari sign-in. Get a code here and type it into the installed app.
        </p>
        {code ? (
          <p className="text-center font-mono text-3xl tracking-[0.4em]" aria-label="Pairing code">
            {code.code}
          </p>
        ) : null}
        <Button variant="secondary" className="w-full" onClick={createCode}>
          {code ? "New code" : "Show pairing code"}
        </Button>
      </Card>

      <Button variant="danger" className="w-full" onClick={logout}>
        Sign out
      </Button>
    </div>
  );
}
