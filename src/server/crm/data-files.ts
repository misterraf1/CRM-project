import { CONTACT_SOURCES, LIFECYCLE_STAGES, PRIORITIES, TASK_STATUSES, type ExportFormat, type ImportEntity } from "@/shared";
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

/** Which label a column uses: deals call their stage "Mərhələ", tasks their title "Tapşırıq", … */
const labelKey = (entity: ImportEntity, key: string) =>
  entity === "deal" && key === "stage" ? "dealStage" : entity === "task" && key === "title" ? "taskTitle" : entity === "task" && key === "owner" ? "assignee" : entity === "product" && key === "name" ? "productName" : key;

/** Header label of a built-in column in one language. */
export const columnLabel = (lang: Locale, entity: ImportEntity, key: string) => DICTIONARIES[lang].imports.columns[labelKey(entity, key) as keyof Columns] ?? key;

/**
 * Other names people give these columns (besides the labels in all three languages),
 * including the export headers of Bitrix24, amoCRM, HubSpot, Pipedrive and Zoho, so
 * their files map without manual work.
 */
const SYNONYMS: Record<string, string[]> = {
  name: ["ad soyad", "full name", "fullname", "contact name", "фио", "müştəri adı", "полное имя контакта", "person - name", "person name", "contact full name", "display name"],
  firstName: ["first name", "ad", "имя", "given name", "person - first name"],
  lastName: ["last name", "soyad", "фамилия", "surname", "family name", "person - last name"],
  email: ["e-mail", "e-poçt", "poçt", "mail", "email address", "почта", "электронная почта", "рабочий email", "рабочий e-mail", "личный e-mail", "person - email", "email 1", "primary email"],
  phone: ["tel", "mobil", "nömrə", "telefon nömrəsi", "mobile", "phone number", "тел", "мобильный", "номер", "мобильный телефон", "person - phone", "mobile phone", "phone 1", "primary phone"],
  phone2: ["telefon 2", "phone 2", "рабочий телефон", "work phone", "other phone", "домашний телефон", "home phone", "əlavə telefon", "ev telefonu", "iş telefonu"],
  company: ["şirkətin adı", "organization", "organisation", "company name", "организация", "компания", "название компании", "organization - name", "account name", "associated company"],
  stage: ["lifecycle", "этап", "lifecycle stage", "lead status", "статус лида"],
  source: ["mənbə", "источник", "lead source", "original source", "источник лида"],
  tags: ["etiket", "teq", "tag", "labels", "теги", "метка", "label"],
  owner: ["cavabdeh", "menecer", "responsible", "manager", "менеджер", "ответственный", "contact owner", "deal owner", "deal - owner", "owner name", "record owner"],
  assignee: ["icraçı", "cavabdeh", "assignee", "assigned to", "исполнитель", "ответственный", "task owner"],
  title: ["satış", "başlıq", "deal", "deal name", "сделка", "название", "название сделки", "deal - title", "opportunity name"],
  amount: ["dəyər", "value", "price", "deal value", "сумма", "бюджет", "deal - value", "opportunity amount"],
  currency: ["cur", "валюта", "deal - currency"],
  pipeline: ["proses", "funnel", "воронка продаж", "воронка", "направление", "deal - pipeline"],
  dealStage: ["status", "статус", "стадия сделки", "этап сделки", "deal stage", "deal - stage"],
  contact: ["kontakt", "contact", "client", "контакт", "клиент", "deal - person", "contact name", "associated contact"],
  expectedClose: ["close date", "expected close", "ожидаемое закрытие", "предполагаемая дата закрытия", "closing date", "deal - expected close date"],
  closedAt: ["closed", "closed date", "bağlanıb", "дата закрытия", "deal - won time", "deal - close time"],
  lostReason: ["lost reason", "səbəb", "причина", "причина отказа", "deal - lost reason"],
  productName: ["məhsul", "xidmət", "product", "product name", "item", "товар", "наименование", "услуга"],
  sku: ["kod", "artikul", "artikl", "code", "product code", "article", "артикул", "код"],
  unit: ["vahid", "ölçü vahidi", "uom", "ед. изм.", "единица"],
  price: ["qiymət", "satış qiyməti", "unit price", "цена", "стоимость"],
  tax: ["ədv", "vat", "tax rate", "ндс", "налог"],
  description: ["təsvir", "qeyd", "description", "notes", "описание", "комментарий"],
  taskTitle: ["tapşırıq", "iş", "task", "subject", "задача", "тема"],
  dueAt: ["son tarix", "deadline", "due", "due date", "срок", "крайний срок"],
  priority: ["prioritet", "важность", "приоритет"],
  status: ["vəziyyət", "status", "статус", "состояние"],
};

/** Normalised header → column key, per entity (built-in columns only). */
export function headerKeys(entity: ImportEntity, keys: readonly string[]) {
  const out = new Map<string, string>();
  for (const key of keys) {
    const label = labelKey(entity, key);
    const names = [key, ...Object.values(DICTIONARIES).map((d) => d.imports.columns[label as keyof Columns]), ...(SYNONYMS[label] ?? [])];
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
export const PRIORITY_LOOKUP = labelLookup(PRIORITIES, (d) => d.dashboard.tasks.priority);
export const TASK_STATUS_LOOKUP = labelLookup(TASK_STATUSES, (d) => d.tasks.statuses);

/** Azerbaijani mobile and city codes: a 9-digit number starting with one is local */
const AZ_CODES = /^(10|12|18|2[0-9]|36|50|51|55|60|70|77|99)/;

/**
 * A phone number as typed in a sheet → one stored form: "050 123 45 67", "(050) 1234567",
 * "994501234567" and "00994 50…" all become "+994501234567". Numbers of other countries
 * keep their "+"; anything that isn't 7–15 digits is null (an issue for the row).
 */
export function normalizePhone(raw: string): string | null {
  let d = raw.trim().replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = `+${d.slice(2)}`;
  const plus = d.startsWith("+");
  d = d.replace(/\+/g, "");
  if (!/^\d{7,15}$/.test(d)) return null;
  if (plus) return `+${d}`;
  if (/^994\d{9}$/.test(d)) return `+${d}`;
  if (/^0\d{9}$/.test(d) && AZ_CODES.test(d.slice(1))) return `+994${d.slice(1)}`;
  if (/^\d{9}$/.test(d) && AZ_CODES.test(d)) return `+994${d}`;
  return d;
}

/** Several numbers in one cell ("050 111 22 33, 012 444 55 66" or one per line); null entries are unreadable ones. */
export const splitPhones = (raw: string) =>
  raw
    .split(/[,;\n/|]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ raw: p, phone: normalizePhone(p) }));

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
