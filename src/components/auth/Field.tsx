import clsx from "clsx";
import type { InputHTMLAttributes } from "react";

export function Field({
  label,
  hint,
  invalid,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; invalid?: boolean; name: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...input}
        aria-invalid={invalid || undefined}
        className={clsx(
          "mt-1.5 block h-10 w-full rounded-lg border bg-surface px-3 text-sm outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20",
          invalid ? "border-danger" : "border-border",
        )}
      />
      {hint && <span className="mt-1 block text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="h-10 w-full rounded-lg bg-accent text-sm font-semibold text-accent-fg hover:bg-accent/90 focus-visible:ring-2"
    >
      {children}
    </button>
  );
}
