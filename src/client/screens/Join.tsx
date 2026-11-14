import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, ColorPicker, ErrorText, Field, inputClass } from "../components/ui";

export function JoinScreen() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.get<{ kind: "join" | "device"; memberName: string | null }>(`/invites/${token}`),
    retry: false,
  });
  const colors = useQuery({ queryKey: ["colors"], queryFn: () => api.get<string[]>("/colors/available"), enabled: invite.data?.kind === "join" });
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!color && colors.data?.length) setColor(colors.data[0]);
  }, [colors.data, color]);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/invites/${token}/accept`, invite.data?.kind === "join" ? { displayName, color } : {});
      await qc.invalidateQueries();
      navigate("/?welcome=1", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (invite.isLoading) return <div className="p-6 text-slate-500">Checking your link…</div>;
  if (invite.error)
    return (
      <div className="mx-auto max-w-md space-y-3 p-6">
        <h1 className="text-2xl font-semibold">Link not valid</h1>
        <p className="text-slate-600">This link is invalid, has expired (links last 7 days) or was already used. Ask a flatmate for a new one.</p>
        <Link to="/pair" className="text-teal-700 underline">
          I have a pairing code
        </Link>
      </div>
    );

  if (invite.data?.kind === "device")
    return (
      <form onSubmit={accept} className="mx-auto max-w-md space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Sign in as {invite.data.memberName}</h1>
        <p className="text-slate-600">This link signs this device in as {invite.data.memberName}.</p>
        <ErrorText error={error} />
        <Button className="w-full" disabled={busy}>
          Sign in
        </Button>
      </form>
    );

  return (
    <form onSubmit={accept} className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Join the household</h1>
      <Field label="Your name">
        <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={30} autoFocus />
      </Field>
      <Field label="Pick your colour">
        <ColorPicker colors={colors.data ?? []} value={color} onChange={setColor} />
      </Field>
      <ErrorText error={error} />
      <Button className="w-full" disabled={busy || !color}>
        Join
      </Button>
    </form>
  );
}
