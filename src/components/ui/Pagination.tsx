import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/** Page numbers to show: the first, the last, and two either side of the current one. */
export function pageWindow(page: number, pages: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 2 || (page <= 3 && p <= 5) || (page >= pages - 2 && p >= pages - 4)) out.push(p);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

/** Numbered pages as links (the page lives in the URL). */
export function Pagination({ page, pages, href, labels }: { page: number; pages: number; href: (page: number) => string; labels: { nav: string; prev: string; next: string; page: string } }) {
  if (pages <= 1) return null;
  const box = "grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-medium transition-colors";
  const arrow = (to: number, label: string, Icon: typeof ChevronLeft, off: boolean) =>
    off ? (
      <span className={clsx(box, "border border-border text-fg-subtle opacity-50")} aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
    ) : (
      <Link href={href(to)} aria-label={label} className={clsx(box, "border border-border text-fg-muted hover:bg-muted")}>
        <Icon className="h-4 w-4" />
      </Link>
    );
  return (
    <nav aria-label={labels.nav} className="flex items-center gap-1">
      {arrow(page - 1, labels.prev, ChevronLeft, page <= 1)}
      {pageWindow(page, pages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-fg-subtle" aria-hidden>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={labels.page.replace("{n}", String(p))}
            className={clsx(box, p === page ? "bg-accent text-accent-fg shadow-sm" : "text-fg-muted hover:bg-muted")}
          >
            {p}
          </Link>
        ),
      )}
      {arrow(page + 1, labels.next, ChevronRight, page >= pages)}
    </nav>
  );
}
