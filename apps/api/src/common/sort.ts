type Key<T> = [(row: T) => number | string | Date | null | undefined, "asc" | "desc"];

/**
 * Multi-key sort with nulls last. MongoDB has no "NULLS LAST", so queries that need
 * it sort in memory after a bounded fetch.
 */
export function sortNullsLast<T>(rows: T[], ...keys: Key<T>[]): T[] {
  const val = (v: number | string | Date | null | undefined) => (v instanceof Date ? v.getTime() : v);
  return [...rows].sort((a, b) => {
    for (const [get, dir] of keys) {
      const x = val(get(a));
      const y = val(get(b));
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1);
    }
    return 0;
  });
}
