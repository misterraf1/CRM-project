"use client";

import { API_SCOPES, type ApiKeyCreatedDto, type ApiKeyDto, type ApiScope } from "@/shared";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

/** Public API keys: made here, shown once, revoked here. */
export function ApiKeysCard({ initial, origin }: { initial: ApiKeyDto[]; origin: string }) {
  const { t, locale } = useI18n();
  const k = t.integrations.api;
  const [keys, setKeys] = useState(initial);
  const [scopes, setScopes] = useState<ApiScope[]>(["contacts.read", "contacts.write"]);
  const [fresh, setFresh] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name || !scopes.length) return;
    startTransition(async () => {
      setError(undefined);
      const res = await api<ApiKeyCreatedDto>("/integrations/api-keys", "POST", { name, scopes });
      if (!res.ok) return setError(errorMessage(t, res.code));
      setKeys((all) => [res.data.apiKey, ...all]);
      setFresh(res.data.key);
      setCopied(false);
      form.reset();
    });
  };

  const revoke = (key: ApiKeyDto) =>
    window.confirm(interpolate(k.confirmRevoke, { name: key.name })) &&
    startTransition(async () => {
      const res = await api<ApiKeyDto[]>(`/integrations/api-keys/${key.id}`, "DELETE");
      if (!res.ok) return setError(errorMessage(t, res.code));
      setKeys(res.data);
    });

  const copy = async () => {
    if (!fresh) return;
    await navigator.clipboard?.writeText(fresh).catch(() => undefined);
    setCopied(true);
  };

  return (
    <section id="api" className="card space-y-4 p-5" aria-labelledby="api-title" aria-busy={pending}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="api-title" className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-accent" aria-hidden />
            {k.title}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-fg-muted">{k.subtitle}</p>
        </div>
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">
          {k.docs}
        </a>
      </div>

      <form onSubmit={create} className="space-y-3 rounded-xl border border-border p-4">
        <label className="block text-sm">
          <span className="text-xs font-medium text-fg-muted">{k.name}</span>
          <input name="name" required maxLength={80} placeholder={k.namePlaceholder} className="input mt-1" />
        </label>
        <fieldset>
          <legend className="text-xs font-medium text-fg-muted">{k.scopes}</legend>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {API_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes((all) => (all.includes(s) ? all.filter((x) => x !== s) : [...all, s]))} className="h-4 w-4" />
                {k.scopeLabels[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={pending || !scopes.length} className="btn-primary">
          {k.create}
        </button>
      </form>

      {fresh && (
        <div role="status" className="space-y-2 rounded-xl border border-success/40 bg-success/5 p-4">
          <p className="text-sm font-medium text-success">{k.created}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-surface px-3 py-2 text-xs">{fresh}</code>
            <button type="button" onClick={copy} className="btn-ghost h-8 border border-border text-xs">
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {copied ? k.copied : k.copy}
            </button>
          </div>
          <p className="text-xs text-fg-muted">{k.example}:</p>
          <pre className="overflow-x-auto rounded-lg bg-surface px-3 py-2 text-[11px]">{`curl ${origin}/api/v1/contacts \\\n  -H "Authorization: Bearer ${fresh.slice(0, 12)}…"`}</pre>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {keys.length === 0 ? (
        <p className="text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {key.name} <code className="ml-1 text-xs text-fg-subtle">{key.prefix}…</code>
                </p>
                <p className="text-xs text-fg-muted">
                  {key.scopes.map((s) => k.scopeLabels[s]).join(", ")} · {key.lastUsedAt ? interpolate(k.lastUsed, { date: formatDateTime(key.lastUsedAt, locale) }) : k.neverUsed}
                </p>
              </div>
              <button type="button" onClick={() => revoke(key)} aria-label={`${k.revoke}: ${key.name}`} className="btn-ghost h-8 gap-1 px-2 text-xs text-danger">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {k.revoke}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
