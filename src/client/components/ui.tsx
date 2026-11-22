import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Member } from "../../shared/types";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-teal-700 text-white active:bg-teal-800 disabled:bg-slate-300",
    secondary: "bg-white text-slate-800 ring-1 ring-slate-300 active:bg-slate-100",
    danger: "bg-white text-red-700 ring-1 ring-red-300 active:bg-red-50",
    ghost: "text-teal-700 active:bg-teal-50",
  }[variant];
  return <button className={`min-h-11 rounded-xl px-4 font-medium transition ${styles} ${className}`} {...props} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>{children}</div>;
}

export function Avatar({ member, size = 28 }: { member?: Member; size?: number }) {
  if (!member) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: member.color, width: size, height: size, fontSize: size * 0.45 }}
      aria-label={member.displayName}
      title={member.displayName}
    >
      {member.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = "w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-teal-600 focus:outline-none";

export function ColorPicker({ colors, value, onChange }: { colors: readonly string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
      {colors.map((c) => (
        <button
          type="button"
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={`h-10 w-10 rounded-full ring-offset-2 ${value === c ? "ring-2 ring-slate-900" : ""}`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-900/40" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Toast({ message, action, onAction, onDone }: { message: string; action?: string; onAction?: () => void; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 8000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return (
    <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white shadow-lg" role="status">
      <span>{message}</span>
      {action && (
        <button className="ml-4 font-semibold text-teal-300" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-700">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-slate-500">{children}</p>;
}
