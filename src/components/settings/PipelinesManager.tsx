"use client";

import type { PipelineDto, StageKind } from "@/shared";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { api, type ClientResult } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

interface StageRow {
  /** Existing stage id; new rows have none */
  id?: string;
  /** Stable React key */
  key: string;
  name: string;
  probability: number;
  kind: StageKind;
}

const rowsOf = (p: PipelineDto): StageRow[] => p.stages.map((s) => ({ id: s.id, key: s.id, name: s.name, probability: s.probability, kind: s.kind }));

/** Pipelines and their stages. Open stages are free-form; one won and one lost stage close the list. */
export function PipelinesManager({ pipelines: initial }: { pipelines: PipelineDto[] }) {
  const { t } = useI18n();
  const k = t.crmSettings;
  const router = useRouter();
  // Each change applies the API's answer at once (a refresh racing the page load could drop it); server data wins on refresh
  const [pipelines, setPipelines] = useState(initial);
  useEffect(() => setPipelines(initial), [initial]);
  const [selectedId, setSelectedId] = useState(pipelines[0]?.id);
  const selected = pipelines.find((p) => p.id === selectedId) ?? pipelines[0];
  const [rows, setRows] = useState<StageRow[]>(selected ? rowsOf(selected) : []);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // Server data wins after every refresh or pipeline switch
  useEffect(() => {
    if (selected) setRows(rowsOf(selected));
  }, [selected]);

  const open = rows.filter((r) => r.kind === "open");
  const closing = rows.filter((r) => r.kind !== "open");

  function conflictMessage(res: Extract<ClientResult<unknown>, { ok: false }>) {
    const d = res.details as { stages?: string[]; deals?: number; pipeline?: string[] } | undefined;
    if (res.code === "CONFLICT" && d?.stages) return interpolate(k.pipelines.stagesInUse, { names: d.stages.join(", ") });
    if (res.code === "CONFLICT" && d?.deals) return k.pipelines.hasDeals;
    if (res.code === "CONFLICT" && d?.pipeline) return k.pipelines.defaultLocked;
    return errorMessage(t, res.code);
  }

  function run<T>(call: () => Promise<ClientResult<T>>, apply: (data: T) => void) {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const res = await call();
      if (!res.ok) return setError(conflictMessage(res));
      apply(res.data);
      router.refresh();
    });
  }

  const replace = (p: PipelineDto) =>
    setPipelines((all) => all.map((x) => (x.id === p.id ? p : p.isDefault ? { ...x, isDefault: false } : x)).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)));

  const update = (key: string, patch: Partial<StageRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function moveOpen(key: string, dir: -1 | 1) {
    const i = open.findIndex((r) => r.key === key);
    const j = i + dir;
    if (j < 0 || j >= open.length) return;
    const next = [...open];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRows([...next, ...closing]);
  }

  function createPipeline(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name"));
    run(
      () => api<PipelineDto>("/pipelines", "POST", { name }),
      (p) => {
        form.reset();
        setPipelines((all) => [...all, p]);
        setSelectedId(p.id);
      },
    );
  }

  if (!selected) return null;
  const p = k.pipelines;

  return (
    <section className="card">
      <div className="px-5 pt-4">
        <h2 className="text-sm font-semibold">{p.title}</h2>
        <p className="mt-1 text-xs text-fg-muted">{p.hint}</p>
        <div role="tablist" aria-label={p.title} className="mt-3 flex flex-wrap gap-1 rounded-lg bg-muted p-0.5 text-xs font-medium sm:w-fit">
          {pipelines.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === selected.id}
              onClick={() => (setSelectedId(x.id), setError(undefined), setSaved(false))}
              className={clsx("rounded-md px-3 py-1.5", x.id === selected.id ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
            >
              {x.name}
              {x.isDefault && <span className="ml-1 text-fg-subtle">· {p.isDefault}</span>}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mx-5 mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <form
        key={selected.id}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api<PipelineDto>(`/pipelines/${selected.id}`, "PATCH", { name: String(new FormData(e.currentTarget).get("name")) }), replace);
        }}
        className="mx-5 mt-3 flex flex-wrap items-end gap-2"
      >
        <label className="field-label min-w-[200px] flex-1">
          {p.name}
          <input name="name" required maxLength={60} defaultValue={selected.name} className="input" />
        </label>
        <button type="submit" disabled={pending} className="btn-ghost">
          {p.rename}
        </button>
        {!selected.isDefault && (
          <>
            <button type="button" disabled={pending} onClick={() => run(() => api<PipelineDto>(`/pipelines/${selected.id}`, "PATCH", { isDefault: true }), replace)} className="btn-ghost">
              {p.makeDefault}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(interpolate(p.confirmDelete, { name: selected.name }))) return;
                run(
                  () => api(`/pipelines/${selected.id}`, "DELETE"),
                  () => (setPipelines((all) => all.filter((x) => x.id !== selected.id)), setSelectedId(undefined)),
                );
              }}
              className="btn-ghost text-danger"
            >
              {p.delete}
            </button>
          </>
        )}
      </form>

      <div className="mx-5 mt-4">
        <h3 className="text-xs font-medium text-fg-muted">{p.stages}</h3>
        <p className="mt-0.5 text-xs text-fg-subtle">{p.stagesHint}</p>
        <ol className="mt-2 space-y-2" aria-busy={pending}>
          {rows.map((r) => {
            const idx = open.findIndex((x) => x.key === r.key);
            return (
              <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_80px_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_96px_110px_auto]">
                <input
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  required
                  maxLength={40}
                  aria-label={p.stageName}
                  className={clsx("input mt-0", r.kind === "won" && "text-success", r.kind === "lost" && "text-danger")}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={r.probability}
                  disabled={r.kind !== "open"}
                  onChange={(e) => update(r.key, { probability: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
                  aria-label={`${p.probability}: ${r.name}`}
                  className="input mt-0"
                />
                <span className="hidden text-xs text-fg-subtle sm:block">{p.kinds[r.kind]}</span>
                <span className="flex items-center">
                  {r.kind === "open" && (
                    <>
                      <button type="button" onClick={() => moveOpen(r.key, -1)} disabled={idx === 0} aria-label={`${t.crmSettings.fields.moveUp}: ${r.name}`} className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted disabled:opacity-30">
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" onClick={() => moveOpen(r.key, 1)} disabled={idx === open.length - 1} aria-label={`${t.crmSettings.fields.moveDown}: ${r.name}`} className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted disabled:opacity-30">
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                        disabled={open.length === 1}
                        aria-label={`${p.removeStage}: ${r.name}`}
                        className="grid h-7 w-7 place-items-center rounded-md text-danger hover:bg-muted disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2 pb-4">
          <button
            type="button"
            disabled={open.length >= 18}
            onClick={() => setRows([...open, { key: crypto.randomUUID(), name: "", probability: 50, kind: "open" }, ...closing])}
            className="inline-flex items-center gap-1 px-2 text-xs font-medium text-accent hover:underline disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {p.addStage}
          </button>
          <button
            type="button"
            disabled={pending || rows.some((r) => !r.name.trim())}
            onClick={() =>
              run(
                () => api<PipelineDto>(`/pipelines/${selected.id}/stages`, "PATCH", { stages: rows.map(({ id, name, probability, kind }) => ({ id, name: name.trim(), probability, kind })) }),
                (p) => (replace(p), setSaved(true)),
              )
            }
            className="btn-primary ml-auto"
          >
            {p.saveStages}
          </button>
          {saved && (
            <span role="status" className="text-sm text-success">
              {k.saved}
            </span>
          )}
        </div>
      </div>

      <form onSubmit={createPipeline} className="flex flex-wrap gap-2 border-t border-border p-3">
        <input name="name" required maxLength={60} placeholder={p.name} aria-label={p.name} className="input mt-0 min-w-[200px] flex-1" />
        <button type="submit" disabled={pending} className="btn-ghost">
          <Plus className="h-4 w-4" aria-hidden />
          {p.add}
        </button>
      </form>
    </section>
  );
}
