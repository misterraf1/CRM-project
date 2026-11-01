"use client";

import { DUPLICATE_MODES, IMPORT_ENTITIES, IMPORT_LIMITS, type DuplicateMode, type ImportEntity, type ImportJobDto, type WorkbookResultDto } from "@/shared";
import clsx from "clsx";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { api, type ClientResult } from "@/lib/api/client";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";
import { SummaryTiles } from "./ImportWizard";

/**
 * Everything in one Excel file: each sheet is recognised (by its tab name or columns)
 * and checked with a full dry run, so a deal pointing at a customer in the "People"
 * sheet of the same file is matched before anything is written.
 */
export function WorkbookImport({ kinds, onImported }: { kinds: ImportEntity[]; onImported: (history: ImportJobDto[]) => void }) {
  const { t, locale } = useI18n();
  const k = t.imports;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<WorkbookResultDto | null>(null);
  const [sheets, setSheets] = useState<Record<string, ImportEntity | "">>({});
  const [duplicates, setDuplicates] = useState<DuplicateMode>("skip");
  const [createCompanies, setCreateCompanies] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const done = !!result?.batchId;

  function failure(res: Extract<ClientResult<unknown>, { ok: false }>) {
    const reason = (res.details as { file?: string[] } | undefined)?.file?.[0] as keyof typeof k.fileErrors | undefined;
    if (res.code === "FILE_TOO_LARGE") return k.fileErrors.too_large;
    if (reason && reason in k.fileErrors) return interpolate(k.fileErrors[reason], { rows: formatNumber(IMPORT_LIMITS.rows * 2, locale) });
    return errorMessage(t, res.code);
  }

  function send(path: string, chosen: File, overrides: Record<string, ImportEntity | "">, after: (r: WorkbookResultDto) => void) {
    setError(undefined);
    const form = new FormData();
    form.append("file", chosen);
    form.append("options", JSON.stringify({ duplicates, createCompanies, ...(Object.keys(overrides).length ? { sheets: overrides } : {}) }));
    startTransition(async () => {
      const res = await api<WorkbookResultDto>(path, "POST", form);
      if (!res.ok) return setError(failure(res));
      after(res.data);
    });
  }

  function read(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const chosen = new FormData(e.currentTarget).get("file");
    if (!(chosen instanceof File) || !chosen.size) return;
    setFile(chosen);
    setSheets({});
    send("/imports/workbook/preview", chosen, {}, (r) => {
      setResult(r);
      setStale(false);
    });
  }

  const check = () => file && send("/imports/workbook/preview", file, sheets, (r) => (setResult(r), setStale(false)));
  const run = () =>
    file &&
    send("/imports/workbook", file, sheets, async (r) => {
      setResult(r);
      const history = await api<ImportJobDto[]>("/imports");
      if (history.ok) onImported(history.data);
      router.refresh();
    });

  const restart = () => (setFile(null), setResult(null), setSheets({}), setError(undefined));
  const total = result?.sheets.reduce((n, s) => n + s.summary.create + s.summary.update, 0) ?? 0;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {!result && (
        <form onSubmit={read} className="card space-y-4 p-5">
          <p className="text-sm text-fg-muted">{k.modeWorkbookHint}</p>
          <label className="field-label">
            {k.file}
            <input
              type="file"
              name="file"
              required
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="input h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
            />
          </label>
          <fieldset>
            <legend className="field-label">{k.duplicates}</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {DUPLICATE_MODES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="duplicates" checked={duplicates === m} onChange={() => setDuplicates(m)} className="accent-[rgb(var(--accent))]" />
                  {k.duplicateModes[m]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={createCompanies} onChange={(e) => setCreateCompanies(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
            {k.createCompanies}
          </label>
          <ul className="list-disc space-y-1 pl-5 text-xs text-fg-subtle">
            <li>{k.phonesHint}</li>
            <li>{k.otherCrm}</li>
            <li>{k.automationNote}</li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="btn-primary">
              <Upload className="h-4 w-4" aria-hidden />
              {k.read}
            </button>
            <a href={`/api/v1/imports/template?entity=workbook&lang=${locale}`} download className="btn-ghost">
              <Download className="h-4 w-4" aria-hidden />
              {k.workbookTemplate}
            </a>
          </div>
        </form>
      )}

      {result && (
        <section className="card" aria-live="polite" aria-busy={pending}>
          <h2 className="flex items-center gap-2 px-5 pt-4 text-sm font-semibold">
            <FileSpreadsheet className="h-4 w-4 text-fg-subtle" aria-hidden />
            {done ? k.workbookDone : result.fileName}
          </h2>
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {result.sheets.map((s) => {
              const value = sheets[s.sheet] ?? s.entity ?? "";
              return (
                <li key={s.sheet} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="min-w-0 flex-1 text-sm font-medium">
                      {k.sheet}: {s.sheet} <span className="font-normal text-fg-subtle">· {interpolate(k.rowsTotal, { n: formatNumber(s.rows, locale) })}</span>
                    </p>
                    {!done && (
                      <label className="flex items-center gap-2 text-xs text-fg-muted">
                        {k.sheetAs}
                        <select
                          value={value}
                          onChange={(e) => (setSheets((all) => ({ ...all, [s.sheet]: e.target.value as ImportEntity | "" })), setStale(true))}
                          className={clsx("input mt-0 h-8 w-auto text-xs", !value && "border-warning")}
                        >
                          <option value="">{s.entity ? k.sheetSkip : k.sheetUnknown}</option>
                          {IMPORT_ENTITIES.filter((e) => kinds.includes(e)).map((e) => (
                            <option key={e} value={e}>
                              {k.entities[e]}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {done && s.entity && <span className="text-xs text-fg-muted">{k.entities[s.entity]}</span>}
                  </div>
                  {s.entity && !stale && (
                    <>
                      {s.missing.length > 0 ? (
                        <p className="text-xs text-danger">{interpolate(k.noRequired, { field: s.missing.join(", ") })}</p>
                      ) : (
                        <SummaryTiles summary={s.summary} t={t} locale={locale} />
                      )}
                      {s.issues.length > 0 && (
                        <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border text-xs">
                          {s.issues.slice(0, 20).map((issue, i) => (
                            <li key={i} className="flex gap-3 px-3 py-1.5">
                              <span className="w-16 shrink-0 text-fg-subtle">{interpolate(k.line, { n: issue.row })}</span>
                              <span className={issue.skipped ? "text-fg-muted" : "text-danger"}>
                                {issue.field ? `${issue.field}: ` : ""}
                                {interpolate(k.issues[issue.code], { value: issue.value ?? "" })}
                                {issue.value && !issue.skipped ? ` «${issue.value}»` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.issueCount > Math.min(20, s.issues.length) && <p className="text-xs text-fg-subtle">{interpolate(k.issuesMore, { n: s.issueCount - Math.min(20, s.issues.length) })}</p>}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-border p-5">
            {done ? (
              <button type="button" onClick={restart} className="btn-primary">
                {k.another}
              </button>
            ) : (
              <>
                <button type="button" onClick={restart} className="btn-ghost">
                  {k.back}
                </button>
                {stale ? (
                  <button type="button" onClick={check} disabled={pending} className="btn-ghost border border-border">
                    {k.check}
                  </button>
                ) : (
                  <button type="button" onClick={run} disabled={pending || total === 0} className="btn-primary">
                    {k.run}
                  </button>
                )}
                {!stale && total === 0 && <span className="text-xs text-fg-muted">{k.nothing}</span>}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
