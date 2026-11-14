import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useMe, useMembers, useSession } from "../hooks";
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
