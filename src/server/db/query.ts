import type { Document } from "mongodb";
import type { Filter } from "./repo";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Substring match (case-insensitive by default). */
export const contains = (q: string, insensitive = true) => ({ $regex: escape(q), ...(insensitive ? { $options: "i" } : {}) });

/** Suffix match. */
export const endsWith = (q: string) => ({ $regex: `${escape(q)}$` });

/** All filters together, skipping empty ones. */
export function and(...filters: (Filter | null | undefined | false)[]): Filter {
  const parts = filters.filter((f): f is Filter => !!f && Object.keys(f).length > 0);
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0]! : { $and: parts };
}

/** Rows grouped by a key, e.g. children by parent id. */
export function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

interface Aggregates {
  aggregate<R extends Document>(pipeline: Document[]): Promise<R[]>;
}

/** Count (and optionally sum a field) per value of `field` among matching documents. */
export async function countBy(repo: Aggregates, field: string, match: Filter, sumField?: string): Promise<Map<string, { count: number; sum: number }>> {
  const rows = await repo.aggregate<{ _id: string; count: number; sum: number }>([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 }, sum: { $sum: sumField ? `$${sumField}` : 0 } } },
  ]);
  return new Map(rows.map((r) => [r._id, { count: r.count, sum: r.sum }]));
}

/** Sum of a field among matching documents. */
export async function sumOf(repo: Aggregates, field: string, match: Filter): Promise<{ count: number; sum: number }> {
  const [row] = await repo.aggregate<{ count: number; sum: number }>([{ $match: match }, { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: `$${field}` } } }]);
  return { count: row?.count ?? 0, sum: row?.sum ?? 0 };
}
