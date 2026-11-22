import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, ErrorText, Field, inputClass } from "../components/ui";

export function PairScreen() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/pair", { code });
      await qc.invalidateQueries();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Enter pairing code</h1>
      <p className="text-slate-600">
        On a device where you're already signed in, open <b>Settings → Pairing code</b> and type the 6 characters here. Codes last 10 minutes.
      </p>
      <Field label="Code">
        <input
          className={`${inputClass} text-center font-mono text-2xl tracking-[0.4em] uppercase`}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          autoCapitalize="characters"
          autoComplete="one-time-code"
          required
        />
      </Field>
      <ErrorText error={error} />
      <Button className="w-full" disabled={code.length !== 6}>
        Sign in
      </Button>
    </form>
  );
}
