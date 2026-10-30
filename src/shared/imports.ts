import { z } from "zod";
import { CONTACT_SOURCES, LIFECYCLE_STAGES } from "./crm-schemas";

/** What a file can be imported as. People and companies have separate custom fields. */
export const IMPORT_ENTITIES = ["person", "company", "deal"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

/** Rows matching an existing record (people/companies: email, phone; companies also name). */
export const DUPLICATE_MODES = ["skip", "update", "create"] as const;
export type DuplicateMode = (typeof DUPLICATE_MODES)[number];

/** Built-in columns per entity; custom fields are mapped as `cf.<fieldId>`. */
export const IMPORT_COLUMNS = {
  person: ["name", "email", "phone", "company", "stage", "source", "tags", "owner"],
  company: ["name", "email", "phone", "stage", "source", "tags", "owner"],
  deal: ["title", "amount", "currency", "pipeline", "stage", "contact", "owner", "expectedClose", "closedAt", "lostReason"],
} as const satisfies Record<ImportEntity, readonly string[]>;
export type ImportColumn = (typeof IMPORT_COLUMNS)[ImportEntity][number];

/** Columns a row can't be imported without */
export const REQUIRED_COLUMNS: Record<ImportEntity, ImportColumn> = { person: "name", company: "name", deal: "title" };

export const IMPORT_LIMITS = { fileMb: 5, rows: 5000, columns: 60 } as const;

/** Sent as one JSON text field next to the file (multipart) */
export const importOptionsSchema = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  /** Target per file column, by position: a column key, `cf.<id>`, or "" to ignore. Omitted: suggested from the headers. */
  mapping: z.array(z.string().max(80)).max(IMPORT_LIMITS.columns).optional(),
  duplicates: z.enum(DUPLICATE_MODES).default("skip"),
  /** People: a company name with no matching company creates one (otherwise kept as text) */
  createCompanies: z.boolean().default(true),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;

export const importRequestSchema = z.object({
  options: z
    .string()
    .max(20_000)
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Malformed JSON" });
        return z.NEVER;
      }
    })
    .pipe(importOptionsSchema),
});

export const EXPORT_FORMATS = ["csv", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const exportBase = {
  format: z.enum(EXPORT_FORMATS).default("xlsx"),
  /** Language of the column headers and stage/source names */
  lang: z.enum(["az", "en", "ru"]).default("az"),
};

/** The contact list's filters, so "export" takes exactly what the list shows */
export const contactExportQuerySchema = z.object({
  ...exportBase,
  q: z.string().trim().max(100).optional(),
  stage: z.enum(LIFECYCLE_STAGES).optional(),
  ownerId: z.string().min(1).max(64).optional(),
  type: z.enum(["person", "company"]).optional(),
  source: z.enum(CONTACT_SOURCES).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  field: z.string().min(1).max(64).optional(),
  value: z.string().trim().min(1).max(200).optional(),
});
export type ContactExportQuery = z.infer<typeof contactExportQuerySchema>;

export const dealExportQuerySchema = z.object({
  ...exportBase,
  pipelineId: z.string().min(1).max(64).optional(),
});
export type DealExportQuery = z.infer<typeof dealExportQuerySchema>;

export const ISSUE_CODES = [
  "required",
  "too_long",
  "invalid_email",
  "invalid_phone",
  "invalid_number",
  "invalid_date",
  "invalid_value",
  "unknown_option",
  "unknown_stage",
  "closed_stage",
  "unknown_pipeline",
  "unknown_owner",
  "unknown_currency",
  "no_rate",
  "unknown_contact",
  "ambiguous_contact",
  "duplicate",
  "duplicate_in_file",
  "not_visible",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export interface ImportIssue {
  /** Line in the file (the header is line 1) */
  row: number;
  /** Target column (`name`, `cf.<id>`, …); none for whole-row issues */
  field?: string;
  code: IssueCode;
  /** The offending value (cut short) or, for duplicates, the line/record it matched */
  value?: string;
  /** Skipped rows (duplicates) are not errors */
  skipped?: boolean;
}

export interface ImportSummary {
  create: number;
  update: number;
  skip: number;
  failed: number;
  /** Company records created for people's company names */
  companies: number;
}

export interface ImportPreviewDto {
  fileName: string;
  headers: string[];
  /** First data rows, for recognising the columns */
  sample: string[][];
  mapping: string[];
  rows: number;
  /** Required columns not mapped yet (nothing is checked until they are) */
  missing: string[];
  summary: ImportSummary;
  /** First issues only; the full list comes with the finished import */
  issues: ImportIssue[];
  issueCount: number;
}

export interface ImportJobDto {
  id: string;
  entity: ImportEntity;
  fileName: string;
  duplicates: DuplicateMode;
  rows: number;
  summary: ImportSummary;
  by: { id: string; name: string } | null;
  createdAt: string;
}

export interface ImportJobDetailDto extends ImportJobDto {
  headers: string[];
  mapping: string[];
  /** Up to 1000 rows that weren't imported, with the original cells */
  issues: ImportIssue[];
  issueRows: { row: number; cells: string[] }[];
}
