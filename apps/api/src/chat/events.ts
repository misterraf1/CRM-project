import { Injectable } from "@nestjs/common";
import type { ChatEvent } from "@axis/shared";
import { EventEmitter } from "node:events";

/**
 * Team-chat fan-out keyed by membership id, so events reach only the members of a
 * room. In-process (single instance); Redis pub/sub with horizontal scaling.
 */
@Injectable()
export class ChatEvents {
  private readonly bus = new EventEmitter().setMaxListeners(0);

  publish(memberIds: string[], event: ChatEvent) {
    setImmediate(() => {
      for (const id of new Set(memberIds)) this.bus.emit(id, event);
    });
  }

  subscribe(memberId: string, listener: (event: ChatEvent) => void) {
    this.bus.on(memberId, listener);
    return () => this.bus.off(memberId, listener);
  }
}
