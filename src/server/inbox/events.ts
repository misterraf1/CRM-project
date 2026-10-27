import { Injectable } from "@nestjs/common";
import type { InboxEvent } from "@axis/shared";
import { EventEmitter } from "node:events";

/**
 * Per-tenant fan-out for the inbox SSE stream. In-process: correct for a single API
 * instance; with several instances this becomes Redis pub/sub (docs §3).
 * Events carry ids only — clients re-fetch through the authorised API.
 */
@Injectable()
export class InboxEvents {
  private readonly bus = new EventEmitter().setMaxListeners(0);

  publish(tenantId: string, event: InboxEvent) {
    // Deliver after the surrounding transaction has had a chance to commit
    setImmediate(() => this.bus.emit(tenantId, event));
  }

  subscribe(tenantId: string, listener: (event: InboxEvent) => void) {
    this.bus.on(tenantId, listener);
    return () => this.bus.off(tenantId, listener);
  }
}
