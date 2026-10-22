"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * Subscribes to the inbox event stream and refreshes server-rendered data when
 * something changes. Events carry ids only; the refresh re-reads through the API.
 */
export function InboxLive() {
  const { t } = useI18n();
  const router = useRouter();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/v1/inbox/stream");
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
  }, [router]);

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle" title={t.inbox.live}>
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-fg-subtle"}`} aria-hidden />
      {connected ? t.inbox.live : "…"}
    </span>
  );
}
