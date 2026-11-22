import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { MEMBER_COLORS } from "../../shared/colors";
import { Button, ColorPicker, ErrorText, Field, inputClass } from "../components/ui";

export function SetupScreen() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [householdName, setHouseholdName] = useState("Our home");
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState<string>(MEMBER_COLORS[0]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/setup", { token, householdName, displayName, color });
      await qc.invalidateQueries();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Set up your household</h1>
      <p className="text-slate-600">You only do this once. Afterwards you can invite your flatmates with a link.</p>
      <Field label="Setup token">
        <input className={inputClass} value={token} onChange={(e) => setToken(e.target.value)} required />
      </Field>
      <Field label="Household name">
        <input className={inputClass} value={householdName} onChange={(e) => setHouseholdName(e.target.value)} required maxLength={40} />
      </Field>
      <Field label="Your name">
        <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={30} />
      </Field>
      <Field label="Your colour">
        <ColorPicker colors={MEMBER_COLORS} value={color} onChange={setColor} />
      </Field>
      <ErrorText error={error} />
      <Button className="w-full" disabled={busy}>
        Create household
      </Button>
    </form>
  );
}
