"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-ghost h-8 border border-border text-xs">
      <Printer className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
