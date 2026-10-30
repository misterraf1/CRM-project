"use client";

import {
  DUPLICATE_MODES,
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  REQUIRED_COLUMNS,
  type DuplicateMode,
  type FieldDefinitionDto,
  type ImportEntity,
  type ImportIssue,
  type ImportJobDetailDto,
  type ImportJobDto,
  type ImportPreviewDto,
  type ImportSummary,
} from "@/shared";
import clsx from "clsx";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api, type ClientResult } from "@/lib/api/client";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries/az";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

type Step = "file" | "map" | "done";

/** Field key ("name", "cf.<id>") → label in the current language */
function fieldLabel(t: Dictionary, entity: ImportEntity, key: string, fields: FieldDefinitionDto[]) {
  if (key.startsWith("cf.")) return fields.find((f) => f.id === key.slice(3))?.label ?? key;
  const columns = t.imports.columns;
  return (entity === "deal" && key === "stage" ? columns.dealStage : columns[key as keyof typeof columns]) ?? key;
}

function issueText(t: Dictionary, entity: ImportEntity, issue: ImportIssue, fields: FieldDefinitionDto[]) {
  const message = interpolate(t.imports.issues[issue.code], { value: issue.value ?? "" });
  const field = issue.field ? `${fieldLabel(t, entity, issue.field, fields)}: ` : "";
  // Duplicates name what they matched in the message itself
  const value = issue.value && !issue.skipped ? ` «${issue.value}»` : issue.code === "duplicate" ? ` (${issue.value})` : "";
  return `${field}${message}${value}`;
}

/** The rows that weren't imported, as a CSV the user can fix and import again. */
function downloadIssues(t: Dictionary, job: ImportJobDetailDto, fields: FieldDefinitionDto[]) {
  const reasons = new Map<number, string[]>();
  for (const i of job.issues) reasons.set(i.row, [...(reasons.get(i.row) ?? []), issueText(t, job.entity, i, fields)]);
  const rows = [[t.imports.issuesFileLine, t.imports.issuesFileReason, ...job.headers], ...job.issueRows.map((r) => [String(r.row), (reasons.get(r.row) ?? []).join("; "), ...r.cells])];
  const cell = (v: string) => `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
  const blob = new Blob([`﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${job.fileName.replace(/\.[^.]+$/, "")}-issues.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** CSV/Excel import: choose a file, match its columns, check, import. */
export function ImportWizard({ fields, canDeals, history: initialHistory, initialEntity }: { fields: FieldDefinitionDto[]; canDeals: boolean; history: ImportJobDto[]; initialEntity: ImportEntity }) {
  const { t, locale } = useI18n();
  const k = t.imports;
  const router = useRouter();
  const [step, setStep] = useState<Step>("file");
  const [entity, setEntity] = useState<ImportEntity>(initialEntity);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateMode>("skip");
  const [createCompanies, setCreateCompanies] = useState(true);
  /** The preview's summary no longer matches the chosen columns/options */
  const [stale, setStale] = useState(false);
  const [job, setJob] = useState<ImportJobDetailDto | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const entityFields = fields.filter((f) => !f.archived && f.entity === (entity === "person" ? "contact" : entity));
  const label = (key: string) => fieldLabel(t, entity, key, fields);
  const required = REQUIRED_COLUMNS[entity];

  function failure(res: Extract<ClientResult<unknown>, { ok: false }>) {
    const reason = (res.details as { file?: string[] } | undefined)?.file?.[0] as keyof typeof k.fileErrors | undefined;
    if (res.code === "FILE_TOO_LARGE") return k.fileErrors.too_large;
    if (reason && reason in k.fileErrors) return interpolate(k.fileErrors[reason], { rows: formatNumber(IMPORT_LIMITS.rows, locale) });
    return errorMessage(t, res.code);
  }

  function send<T>(path: string, withMapping: boolean, apply: (data: T) => void, chosen = { file, entity }) {
    if (!chosen.file) return;
    setError(undefined);
    const form = new FormData();
    form.append("file", chosen.file);
    form.append("options", JSON.stringify({ entity: chosen.entity, duplicates, createCompanies, ...(withMapping ? { mapping } : {}) }));
    startTransition(async () => {
      const res = await api<T>(path, "POST", form);
      if (!res.ok) return setError(failure(res));
      apply(res.data);
    });
  }

  function read(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Read from the form, not state: a file picked before hydration never reached onChange
    const form = new FormData(e.currentTarget);
    const chosen = form.get("file");
    const kind = (form.get("entity") as ImportEntity | null) ?? entity;
    if (!(chosen instanceof File) || !chosen.size) return;
    setFile(chosen);
    setEntity(kind);
    send<ImportPreviewDto>(
      "/imports/preview",
      false,
      (p) => {
        setPreview(p);
        setMapping(p.mapping);
        setStale(false);
        setStep("map");
      },
      { file: chosen, entity: kind },
    );
  }

  const check = () =>
    send<ImportPreviewDto>("/imports/preview", true, (p) => {
      setPreview(p);
      setStale(false);
    });

  const run = () =>
    send<ImportJobDetailDto>("/imports", true, (j) => {
      setJob(j);
      setHistory((all) => [j, ...all]);
      setStep("done");
      router.refresh();
    });

  function changeMapping(i: number, key: string) {
    setMapping((all) => all.map((m, j) => (j === i ? key : m === key && key ? "" : m)));
    setStale(true);
  }

  function restart() {
    setStep("file");
    setFile(null);
    setPreview(null);
    setJob(null);
    setError(undefined);
  }

  async function historyIssues(id: string) {
    const res = await api<ImportJobDetailDto>(`/imports/${id}`);
    if (res.ok) downloadIssues(t, res.data, fields);
    else setError(errorMessage(t, res.code));
  }

  const missingRequired = !mapping.includes(required);
  const summary = preview && !stale && !preview.missing.length ? preview.summary : null;
  const steps: [Step, string][] = [
    ["file", k.stepFile],
    ["map", k.stepMap],
    ["done", k.done],
  ];

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-xs font-medium" aria-label={k.title}>
        {steps.map(([s, name], i) => (
          <li key={s} aria-current={step === s ? "step" : undefined} className={clsx("rounded-full px-3 py-1", step === s ? "bg-accent text-accent-fg" : "bg-muted text-fg-muted")}>
            {i + 1}. {name}
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {step === "file" && (
        <form onSubmit={read} className="card space-y-4 p-5">
          <fieldset>
            <legend className="field-label">{k.entity}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["person", "company", "deal"] as const)
                .filter((e) => e !== "deal" || canDeals)
                .map((e) => (
                  <label key={e} className={clsx("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", entity === e ? "border-accent bg-accent/5" : "border-border")}>
                    <input type="radio" name="entity" value={e} checked={entity === e} onChange={() => setEntity(e)} className="accent-[rgb(var(--accent))]" />
                    {k.entities[e]}
                  </label>
                ))}
            </div>
          </fieldset>
          <div>
            <label className="field-label">
              {k.file}
              <input
                type="file"
                name="file"
                required
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  aria-describedby="file-hint"
                className="input h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
              />
            </label>
            <p id="file-hint" className="mt-1 text-xs text-fg-subtle">
              {interpolate(k.fileHint, { mb: IMPORT_LIMITS.fileMb, rows: formatNumber(IMPORT_LIMITS.rows, locale) })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="btn-primary">
              <Upload className="h-4 w-4" aria-hidden />
              {k.read}
            </button>
            <a href={`/api/v1/imports/template?entity=${entity}&lang=${locale}`} download className="btn-ghost">
              <Download className="h-4 w-4" aria-hidden />
              {k.template}
            </a>
          </div>
          <p className="text-xs text-fg-subtle">{k.automationNote}</p>
        </form>
      )}

      {step === "map" && preview && (
        <div className="space-y-5">
          <section className="card">
            <div className="px-5 pt-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <FileSpreadsheet className="h-4 w-4 text-fg-subtle" aria-hidden />
                {preview.fileName} · {interpolate(k.rowsTotal, { n: formatNumber(preview.rows, locale) })}
              </h2>
              <p className="mt-1 text-xs text-fg-muted">{k.mapHint}</p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-left text-xs text-fg-subtle">
                    <th scope="col" className="px-5 py-2 font-medium">{k.fileColumn}</th>
                    <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">{k.sample}</th>
                    <th scope="col" className="px-5 py-2 font-medium">{k.target}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.headers.map((h, i) => (
                    <tr key={i}>
                      <td className="break-words px-5 py-2 font-medium">{h || `#${i + 1}`}</td>
                      <td className="hidden max-w-[240px] truncate px-3 py-2 text-xs text-fg-muted sm:table-cell">
                        {preview.sample
                          .map((r) => r[i])
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                      <td className="px-5 py-1.5">
                        <select value={mapping[i] ?? ""} onChange={(e) => changeMapping(i, e.target.value)} aria-label={`${k.target}: ${h || i + 1}`} className="input mt-0 h-8 min-w-[150px] text-xs">
                          <option value="">{k.ignore}</option>
                          {IMPORT_COLUMNS[entity].map((key) => (
                            <option key={key} value={key}>
                              {label(key)}
                              {key === required ? ` (${k.required})` : ""}
                            </option>
                          ))}
                          {entityFields.map((f) => (
                            <option key={f.id} value={`cf.${f.id}`}>
                              {f.label}
                              {f.required ? ` (${k.required})` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 border-t border-border p-5">
              {entity !== "deal" && (
                <fieldset>
                  <legend className="field-label">{k.duplicates}</legend>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    {DUPLICATE_MODES.map((m) => (
                      <label key={m} className="flex items-center gap-2 text-sm">
                        <input type="radio" name="duplicates" checked={duplicates === m} onChange={() => (setDuplicates(m), setStale(true))} className="accent-[rgb(var(--accent))]" />
                        {k.duplicateModes[m]}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-fg-subtle">{k.duplicatesHint}</p>
                </fieldset>
              )}
              {entity === "person" && mapping.includes("company") && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={createCompanies} onChange={(e) => (setCreateCompanies(e.target.checked), setStale(true))} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                  {k.createCompanies}
                </label>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={restart} className="btn-ghost">
                  {k.back}
                </button>
                <button type="button" onClick={check} disabled={pending || missingRequired} className="btn-ghost border border-border">
                  {k.check}
                </button>
                {missingRequired && <span className="text-xs text-danger">{interpolate(k.noRequired, { field: label(required) })}</span>}
              </div>
            </div>
          </section>

          {summary && (
            <section className="card p-5" aria-live="polite">
              <SummaryTiles summary={summary} t={t} locale={locale} />
              {preview.issues.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-medium text-fg-muted">{k.issuesTitle}</h3>
                  <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                    {preview.issues.map((issue, i) => (
                      <li key={i} className="flex gap-3 px-3 py-1.5">
                        <span className="w-20 shrink-0 text-xs text-fg-subtle">{interpolate(k.line, { n: issue.row })}</span>
                        <span className={issue.skipped ? "text-fg-muted" : "text-danger"}>{issueText(t, entity, issue, fields)}</span>
                      </li>
                    ))}
                  </ul>
                  {preview.issueCount > preview.issues.length && <p className="mt-1 text-xs text-fg-subtle">{interpolate(k.issuesMore, { n: preview.issueCount - preview.issues.length })}</p>}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" onClick={run} disabled={pending || summary.create + summary.update === 0} className="btn-primary">
                  {k.run}
                </button>
                {summary.create + summary.update === 0 && <span className="text-xs text-fg-muted">{k.nothing}</span>}
              </div>
            </section>
          )}
        </div>
      )}

      {step === "done" && job && (
        <section className="card p-5" aria-live="polite">
          <h2 className="text-sm font-semibold">{k.done}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {job.fileName} · {interpolate(k.rowsTotal, { n: formatNumber(job.rows, locale) })}
          </p>
          <div className="mt-4">
            <SummaryTiles summary={job.summary} t={t} locale={locale} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {job.issueRows.length > 0 && (
              <button type="button" onClick={() => downloadIssues(t, job, fields)} className="btn-ghost border border-border">
                <Download className="h-4 w-4" aria-hidden />
                {k.downloadIssues}
              </button>
            )}
            <Link href={job.entity === "deal" ? "/deals" : `/crm?type=${job.entity}`} className="btn-primary">
              {job.entity === "deal" ? t.deals.title : t.crm.title}
            </Link>
            <button type="button" onClick={restart} className="btn-ghost">
              {k.another}
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="px-5 pt-4 text-sm font-semibold">{k.history}</h2>
        {history.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-muted">{k.noHistory}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{h.fileName}</span>
                  <span className="ml-2 text-xs text-fg-subtle">
                    {k.entities[h.entity]} · {formatDateTime(h.createdAt, locale)}
                    {h.by && ` · ${interpolate(k.by, { name: h.by.name })}`}
                  </span>
                </span>
                <span className="tabular text-xs text-fg-muted">
                  {k.summary.create}: {h.summary.create} · {k.summary.update}: {h.summary.update} · {k.summary.skip}: {h.summary.skip} · {k.summary.failed}: {h.summary.failed}
                </span>
                {h.summary.skip + h.summary.failed > 0 && (
                  <button type="button" onClick={() => historyIssues(h.id)} aria-label={`${k.downloadIssues}: ${h.fileName}`} title={k.downloadIssues} className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted">
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryTiles({ summary, t, locale }: { summary: ImportSummary; t: Dictionary; locale: Parameters<typeof formatNumber>[1] }) {
  const k = t.imports.summary;
  const tiles: [string, number, string][] = [
    [k.create, summary.create, "text-success"],
    [k.update, summary.update, "text-accent"],
    [k.skip, summary.skip, "text-fg-muted"],
    [k.failed, summary.failed, summary.failed ? "text-danger" : "text-fg-muted"],
  ];
  if (summary.companies) tiles.push([k.companies, summary.companies, "text-success"]);
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map(([name, n, color]) => (
        <div key={name} className="rounded-lg bg-muted px-3 py-2">
          <dt className="text-xs text-fg-muted">{name}</dt>
          <dd className={clsx("tabular text-lg font-semibold", color)}>{formatNumber(n, locale)}</dd>
        </div>
      ))}
    </dl>
  );
}
