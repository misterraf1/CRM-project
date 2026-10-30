import { Download } from "lucide-react";

/** "Export" with the two formats; a plain disclosure, so it works without JavaScript. */
export function ExportMenu({ href, label, hint }: { href: string; label: string; hint?: string }) {
  const sep = href.includes("?") ? "&" : "?";
  return (
    <details className="relative">
      <summary className="btn-ghost cursor-pointer list-none border border-border [&::-webkit-details-marker]:hidden">
        <Download className="h-4 w-4" aria-hidden />
        {label}
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-border bg-surface p-1 shadow-lg">
        <a href={`${href}${sep}format=xlsx`} download className="block rounded-md px-3 py-2 text-sm hover:bg-muted">
          Excel (.xlsx)
        </a>
        <a href={`${href}${sep}format=csv`} download className="block rounded-md px-3 py-2 text-sm hover:bg-muted">
          CSV
        </a>
        {hint && <p className="px-3 pb-1.5 pt-1 text-xs text-fg-subtle">{hint}</p>}
      </div>
    </details>
  );
}
