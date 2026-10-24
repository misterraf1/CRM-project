import clsx from "clsx";
import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { StatTile } from "@/components/ui/StatTile";
import { getSystemHealth } from "@/lib/api/admin";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { interpolate } from "@/lib/i18n/locales";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "System" };

export default async function AdminSystemPage() {
  const [{ t, locale }, s] = await Promise.all([getI18n(), getSystemHealth()]);
  const k = t.admin.system;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
        <p className="mt-0.5 text-xs text-fg-subtle">{k.inMemory}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs text-fg-muted">{k.db}</p>
          <p className={clsx("mt-1 flex items-center gap-1.5 text-lg font-semibold", s.db.ok ? "text-success" : "text-danger")}>
            {s.db.ok ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />}
            {s.db.ok ? k.ok : k.down}
          </p>
          {s.db.latencyMs !== null && <p className="mt-1 text-[11px] text-fg-subtle">{interpolate(k.latency, { ms: s.db.latencyMs })}</p>}
        </div>
        <StatTile label={k.uptime} value={formatDuration(Math.round(s.uptimeSec / 60), locale)} hint={`${k.node} ${s.node}`} />
        <StatTile label={k.memory} value={`${formatNumber(s.memoryMb, locale)} MB`} />
        <StatTile label={k.provider} value={s.billingProvider.toUpperCase()} hint={s.billingProvider === "demo" ? k.demoProvider : undefined} />
      </div>

      <section className="card relative overflow-x-auto">
        <h2 className="px-5 pt-4 text-sm font-semibold">{k.jobs}</h2>
        {!s.jobsEnabled && <p className="mx-5 mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{k.jobsDisabled}</p>}
        <table className="mt-2 w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-subtle">
              <th scope="col" className="px-5 py-2 font-medium">{t.admin.nav.system}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{k.runs}</th>
              <th scope="col" className="px-3 py-2 font-medium">{k.lastRun}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{k.duration}</th>
              <th scope="col" className="px-5 py-2 font-medium">{k.lastError}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {s.jobs.map((j) => (
              <tr key={j.name}>
                <td className="px-5 py-2 font-mono text-xs">{j.name}</td>
                <td className="tabular px-3 text-right">{j.runs}</td>
                <td className="px-3 text-xs text-fg-muted">{j.lastRunAt ? formatDateTime(j.lastRunAt, locale) : k.never}</td>
                <td className="tabular px-3 text-right text-xs">{j.lastDurationMs !== null ? `${j.lastDurationMs} ms` : ""}</td>
                <td className={clsx("px-5 text-xs", j.lastError ? "text-danger" : "text-fg-subtle")}>{j.lastError ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold">{k.webhooks}</h2>
          <p className="mt-2 text-sm">
            {k.received}: <span className="tabular font-medium">{s.webhooks.received24h}</span> · {k.failed}:{" "}
            <span className={clsx("tabular font-medium", s.webhooks.failed24h && "text-danger")}>{s.webhooks.failed24h}</span>
          </p>
          <h3 className="mt-4 text-xs font-medium text-fg-muted">{k.recentErrors}</h3>
          {s.webhooks.recentErrors.length === 0 ? (
            <p className="mt-1 text-xs text-fg-subtle">{k.noErrors}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs">
              {s.webhooks.recentErrors.map((w) => (
                <li key={w.id} className="flex gap-2">
                  <span className="shrink-0 text-fg-subtle">{formatDateTime(w.receivedAt, locale)}</span>
                  <span className="font-mono">{w.provider}</span>
                  <span className="truncate text-danger">{w.error}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="text-sm font-semibold">{k.channels}</h2>
          <p className="mt-2 text-sm">
            {k.connected}: <span className="tabular font-medium">{s.channels.connected}</span> · {k.channelErrors}:{" "}
            <span className={clsx("tabular font-medium", s.channels.error && "text-danger")}>{s.channels.error}</span>
          </p>
          {s.channels.errors.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {s.channels.errors.map((c) => (
                <li key={c.id}>
                  {c.tenant} · {c.name} <span className="font-mono text-fg-subtle">{c.type}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
