"use client";

import type { CustomFieldValues, FieldDefinitionDto } from "@/shared";
import { moneyInputValue, parseMoneyInput } from "@/lib/format";

const name = (f: FieldDefinitionDto) => `cf.${f.id}`;

/**
 * Reads the inputs rendered by <CustomFieldInputs> back into API values (empty = null).
 * Returns the ids of fields that couldn't be parsed instead, so the form can mark them.
 */
export function readCustomFields(form: FormData, fields: FieldDefinitionDto[]): { values: CustomFieldValues } | { invalid: string[] } {
  const values: CustomFieldValues = {};
  const invalid: string[] = [];
  for (const f of fields) {
    const raw = form.get(name(f));
    const text = typeof raw === "string" ? raw.trim() : "";
    switch (f.type) {
      case "checkbox":
        values[f.id] = raw === "true";
        break;
      case "multiselect":
        values[f.id] = form.getAll(name(f)).map(String);
        break;
      case "number":
        if (text && !Number.isFinite(Number(text.replace(",", ".")))) invalid.push(name(f));
        values[f.id] = text ? Number(text.replace(",", ".")) : null;
        break;
      case "currency": {
        const minor = text ? parseMoneyInput(text) : null;
        if (text && minor === null) invalid.push(name(f));
        values[f.id] = minor;
        break;
      }
      default:
        values[f.id] = text || null;
    }
  }
  return invalid.length ? { invalid } : { values };
}

/** Inputs for a record's custom fields, named `cf.<id>`; laid out for a two-column form grid. */
export function CustomFieldInputs({ fields, values = {}, invalid = [] }: { fields: FieldDefinitionDto[]; values?: CustomFieldValues; invalid?: string[] }) {
  if (!fields.length) return null;
  const cls = (f: FieldDefinitionDto) => (invalid.includes(name(f)) ? "input border-danger" : "input");
  const aria = (f: FieldDefinitionDto) => (invalid.includes(name(f)) ? { "aria-invalid": true as const } : {});

  return (
    <>
      {fields.map((f) => {
        const v = values[f.id];
        const label = (
          <>
            {f.label}
            {f.required && <span className="text-danger"> *</span>}
          </>
        );
        if (f.type === "checkbox") {
          return (
            <label key={f.id} className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name={name(f)} value="true" defaultChecked={v === true} className="h-4 w-4 accent-[rgb(var(--accent))]" />
              {label}
            </label>
          );
        }
        if (f.type === "multiselect") {
          const chosen = Array.isArray(v) ? v : [];
          return (
            <fieldset key={f.id} className="sm:col-span-2" {...aria(f)}>
              <legend className="text-sm font-medium text-fg-muted">{label}</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {f.options.map((o) => (
                  <label key={o} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name={name(f)} value={o} defaultChecked={chosen.includes(o)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                    {o}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        return (
          <label key={f.id} className="field-label">
            {label}
            {f.type === "select" ? (
              <select name={name(f)} defaultValue={typeof v === "string" ? v : ""} required={f.required} className={cls(f)} {...aria(f)}>
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={name(f)}
                type={f.type === "date" ? "date" : "text"}
                inputMode={f.type === "number" || f.type === "currency" ? "decimal" : undefined}
                maxLength={f.type === "text" ? 1000 : undefined}
                required={f.required}
                defaultValue={v === null || v === undefined ? "" : f.type === "currency" && typeof v === "number" ? moneyInputValue(v) : String(v)}
                className={cls(f)}
                {...aria(f)}
              />
            )}
          </label>
        );
      })}
    </>
  );
}
