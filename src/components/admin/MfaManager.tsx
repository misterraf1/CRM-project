"use client";

import type { AdminMe, MfaEnabledDto, MfaSetupDto } from "@/shared";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { adminApi } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** Turn 2FA on (QR → code → recovery codes), regenerate recovery codes, turn it off. */
export function MfaManager({ me }: { me: AdminMe }) {
  const { t } = useI18n();
  const k = t.admin.security;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [setup, setSetup] = useState<MfaSetupDto | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const call = <T,>(fn: () => ReturnType<typeof adminApi<T>>, onOk: (data: T) => void) =>
    startTransition(async () => {
      setError(undefined);
      const res = await fn();
      if (!res.ok) return setError(errorMessage(t, res.code, res.details));
      onOk(res.data);
    });

  const codeOf = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const code = String(new FormData(form).get("code")).trim();
    form.reset();
    return code;
  };

  const codeField = (
    <label className="field-label w-40">
      {k.code}
      <input name="code" required minLength={6} maxLength={20} autoComplete="one-time-code" inputMode="numeric" className="input tracking-widest" />
    </label>
  );

  if (codes) {
    return (
      <section className="card max-w-xl space-y-3 p-5">
        <h2 className="text-sm font-semibold">{k.recoveryTitle}</h2>
        <p className="text-sm text-fg-muted">{k.recoveryHint}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-sm" aria-label={k.recoveryTitle}>
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied(true))}
            className="btn-ghost border border-border"
          >
            {copied ? k.copied : k.copy}
          </button>
          <button
            type="button"
            onClick={() => {
              setCodes(null);
              router.refresh();
            }}
            className="btn-primary"
          >
            {k.done}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="max-w-xl space-y-4" aria-busy={pending}>
      <p className={`flex items-center gap-2 text-sm font-medium ${me.mfaEnabled ? "text-success" : "text-warning"}`}>
        {me.mfaEnabled ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <ShieldAlert className="h-4 w-4" aria-hidden />}
        {me.mfaEnabled ? k.on : k.off}
      </p>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {!me.mfaEnabled && !setup && (
        <button type="button" disabled={pending} onClick={() => call(() => adminApi<MfaSetupDto>("/auth/mfa/setup", "POST"), setSetup)} className="btn-primary">
          {k.start}
        </button>
      )}

      {!me.mfaEnabled && setup && (
        <section className="card space-y-4 p-5">
          <p className="text-sm">{k.step1}</p>
          {/* Server-generated QR of the otpauth:// link */}
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt="QR" width={180} height={180} className="rounded-lg bg-white p-2" />
          <p className="text-xs text-fg-muted">
            {k.manual} <code className="select-all break-all rounded bg-muted px-1.5 py-0.5 font-mono text-fg">{setup.secret}</code>
          </p>
          <form onSubmit={(e) => call(() => adminApi<MfaEnabledDto>("/auth/mfa/enable", "POST", { code: codeOf(e) }), (d) => setCodes(d.recoveryCodes))} className="space-y-3">
            <p className="text-sm">{k.step2}</p>
            <div className="flex items-end gap-2">
              {codeField}
              <button type="submit" disabled={pending} className="btn-primary">
                {k.enable}
              </button>
            </div>
          </form>
        </section>
      )}

      {me.mfaEnabled && (
        <>
          <section className="card space-y-3 p-5">
            <h2 className="text-sm font-semibold">{k.recoveryTitle}</h2>
            <p className="text-sm text-fg-muted">{interpolate(k.recoveryLeft, { n: me.recoveryCodesLeft })}</p>
            <form onSubmit={(e) => call(() => adminApi<MfaEnabledDto>("/auth/mfa/recovery-codes", "POST", { code: codeOf(e) }), (d) => setCodes(d.recoveryCodes))} className="flex items-end gap-2">
              {codeField}
              <button type="submit" disabled={pending} className="btn-ghost border border-border">
                {k.regenerate}
              </button>
            </form>
          </section>
          <section className="card space-y-3 p-5">
            <h2 className="text-sm font-semibold">{k.disable}</h2>
            {me.mfaRequired ? (
              <p className="text-sm text-fg-muted">{k.disableBlocked}</p>
            ) : (
              <form onSubmit={(e) => call(() => adminApi("/auth/mfa/disable", "POST", { code: codeOf(e) }), () => router.refresh())} className="flex items-end gap-2">
                {codeField}
                <button type="submit" disabled={pending} className="btn-danger border border-danger/30">
                  {k.disable}
                </button>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
