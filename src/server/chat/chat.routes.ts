import {
  addMembersSchema,
  chatEditSchema,
  chatHistoryQuerySchema,
  chatMessageSchema,
  chatSearchQuerySchema,
  directRoomSchema,
  groupRoomSchema,
  type ChatEvent,
} from "@/shared";
import { authedContext } from "../common/context";
import type { Services } from "../container";
import type { Router } from "../http/router";
import { eventStream } from "../http/sse";

export function chatRoutes(router: Router, s: Services) {
  router.group("/v1/chat", {}, (r) => {
    r.get("rooms", () => s.chat.rooms());

    r.post("rooms/direct", { body: directRoomSchema }, ({ body }) => s.chat.direct(body.memberId));

    r.post("rooms", { body: groupRoomSchema }, ({ body }) => s.chat.group(body));

    r.get("rooms/:id", { query: chatHistoryQuerySchema }, ({ params, query }) => s.chat.detail(params.id!, query.before, query.limit));

    r.post("rooms/:id/members", { status: 204, body: addMembersSchema }, ({ params, body }) => s.chat.addMembers(params.id!, body.memberIds));

    r.delete("rooms/:id/members/me", { status: 204 }, ({ params }) => s.chat.leave(params.id!));

    r.post("rooms/:id/messages", { body: chatMessageSchema }, ({ params, body }) => s.chat.send(params.id!, body));

    r.post("rooms/:id/files", { upload: true }, ({ params, file, fields }) => s.chat.upload(params.id!, file, fields.body));

    r.post("rooms/:id/read", { status: 204 }, ({ params }) => s.chat.read(params.id!));

    r.patch("messages/:id", { body: chatEditSchema }, ({ params, body }) => s.chat.edit(params.id!, body.body));

    r.delete("messages/:id", { status: 204 }, ({ params }) => s.chat.remove(params.id!));

    r.get("search", { query: chatSearchQuerySchema }, ({ query }) => s.chat.search(query.q));

    /** Server-sent events for the caller's rooms only. */
    r.get("stream", { throttle: false }, ({ req }) => {
      const { membershipId } = authedContext();
      return eventStream<ChatEvent>(req.signal, (send) => s.chatEvents.subscribe(membershipId, send));
    });
  });
}
