"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * Subscribes to a server-sent event stream (inbox, team chat) and refreshes the
 * server-rendered page when something changes. Events carry ids only; the refresh
 * re-reads through the authorised API.
 */
export function LiveRefresh({ url }: { url: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(url);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false); // EventSource reconnects by itself
    source.onmessage = () => {
      // Coalesce bursts (several messages in one webhook) into one refresh
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [router, url]);

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle" title={t.inbox.live}>
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-fg-subtle"}`} aria-hidden />
      {connected ? t.inbox.live : "…"}
    </span>
  );
}
