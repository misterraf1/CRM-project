import { CONTACT_SOURCES, LIFECYCLE_STAGES, type ExportFormat, type ImportEntity } from "@/shared";
import az, { type Dictionary } from "@/lib/i18n/dictionaries/az";
import en from "@/lib/i18n/dictionaries/en";
import ru from "@/lib/i18n/dictionaries/ru";
import type { Locale } from "@/lib/i18n/locales";
import { serialToIso, toCsv, toXlsx, type Cell } from "../common/tabular";

/**
 * Shared by import and export: column names in every language (an exported file
 * imports back as is), and lenient readers for the values people type in sheets.
 */

export const DICTIONARIES: Record<Locale, Dictionary> = { az, en, ru };

/** Comparison key: lowercase letters and digits only, Latin diacritics dropped ("E-poçt" ≈ "epoct", "İ" ≈ "i"). Keeps ə. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, "");

type Columns = Dictionary["imports"]["columns"];

/** Header label of a built-in column; deals call their stage "Mərhələ", contacts call theirs "Status". */
export const columnLabel = (lang: Locale, entity: ImportEntity, key: string) => {
  const columns = DICTIONARIES[lang].imports.columns;
  return (entity === "deal" && key === "stage" ? columns.dealStage : columns[key as keyof Columns]) ?? key;
};

/** Other names people give these columns (besides the labels in all three languages) */
const SYNONYMS: Record<string, string[]> = {
  name: ["ad soyad", "soyad", "full name", "fullname", "contact name", "фио", "müştəri adı"],
  email: ["e-mail", "e-poçt", "poçt", "mail", "email address", "почта", "электронная почта"],
  phone: ["tel", "mobil", "nömrə", "telefon nömrəsi", "mobile", "phone number", "тел", "мобильный", "номер"],
  company: ["şirkətin adı", "organization", "organisation", "company name", "организация"],
  stage: ["lifecycle", "этап"],
  source: ["mənbə", "источник"],
  tags: ["etiket", "teq", "tag", "labels", "теги", "метка"],
  owner: ["cavabdeh", "menecer", "responsible", "assignee", "manager", "менеджер"],
  title: ["satış", "başlıq", "deal", "deal name", "сделка", "название"],
  amount: ["dəyər", "value", "price", "deal value"],
  currency: ["cur"],
  pipeline: ["proses", "funnel", "воронка продаж"],
  dealStage: ["status", "статус"],
  contact: ["kontakt", "contact", "client", "контакт"],
  expectedClose: ["close date", "expected close", "ожидаемое закрытие"],
  closedAt: ["closed", "closed date", "bağlanıb"],
  lostReason: ["lost reason", "səbəb", "причина"],
};

/** Normalised header → column key, per entity (built-in columns only). */
export function headerKeys(entity: ImportEntity, keys: readonly string[]) {
  const out = new Map<string, string>();
  for (const key of keys) {
    const labelKey = entity === "deal" && key === "stage" ? "dealStage" : key;
    const names = [key, ...Object.values(DICTIONARIES).map((d) => d.imports.columns[labelKey as keyof Columns]), ...(SYNONYMS[labelKey] ?? [])];
    // A company file's "Company" column is the company's name
    if (entity === "company" && key === "name") names.push(...Object.values(DICTIONARIES).map((d) => d.imports.columns.company), ...SYNONYMS.company!);
    for (const n of names) if (n && !out.has(norm(n))) out.set(norm(n), key);
  }
  return out;
}

/** Code → code, plus every language's label → code (stages, sources). */
function labelLookup<K extends string>(codes: readonly K[], labels: (d: Dictionary) => Record<K, string>) {
  const out = new Map<string, K>();
  for (const code of codes) {
    out.set(norm(code), code);
    for (const d of Object.values(DICTIONARIES)) out.set(norm(labels(d)[code]), code);
  }
  return out;
}

export const LIFECYCLE_LOOKUP = labelLookup(LIFECYCLE_STAGES, (d) => d.crm.stages);
export const SOURCE_LOOKUP = labelLookup(CONTACT_SOURCES, (d) => d.crm.sources);

const CURRENCY_SIGNS: Record<string, string> = { "₼": "AZN", manat: "AZN", man: "AZN", $: "USD", "€": "EUR", "₽": "RUB", rubl: "RUB", "₺": "TRY", "£": "GBP" };
export const currencyCode = (raw: string) => CURRENCY_SIGNS[raw.trim().toLowerCase().replace(/\.$/, "")] ?? raw.trim().toUpperCase();

/**
 * A number as typed in a sheet: "1 234,50", "1.234,50", "1,234.50", "1700 ₼".
 * A lone comma is a decimal comma unless it groups thousands ("1,234"). NaN when unreadable.
 */
export function parseNumber(raw: string): number {
  let s = raw.replace(/[\s  '₼$€₽₺£]|azn|usd|eur|rub|try|gbp|manat|man\./gi, "");
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma >= 0) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? Number(s) : NaN;
}

/** "2025-03-31", "31.03.2025", "31/03/2025" (day first) or an Excel serial number → "YYYY-MM-DD"; null when unreadable. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let parts: [number, number, number];
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s.*)?$/.exec(s))) parts = [Number(m[3]), Number(m[2]), Number(m[1])];
  else if (/^\d{4,5}(\.\d+)?$/.test(s)) return serialToIso(Number(s)).slice(0, 10);
  else return null;
  const [y, mo, d] = parts;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2200 || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const TRUE = new Set(["1", "true", "yes", "y", "bəli", "beli", "hə", "he", "var", "да", "x", "✓", "+"]);
const FALSE = new Set(["0", "false", "no", "n", "xeyr", "yox", "нет", "-"]);
export const parseBool = (raw: string) => {
  const s = raw.trim().toLowerCase();
  return TRUE.has(s) ? true : FALSE.has(s) ? false : null;
};

/** Lists in one cell: "vip, topdan; 2025" */
export const splitList = (raw: string) => [...new Set(raw.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean))];

/** A file download response (exports, templates). */
export function fileResponse(rows: Cell[][], format: ExportFormat, baseName: string, sheetName: string) {
  const name = `${baseName}-${new Date().toISOString().slice(0, 10)}.${format}`;
  const body = format === "csv" ? toCsv(rows) : toXlsx(rows, sheetName);
  return new Response(body, {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
