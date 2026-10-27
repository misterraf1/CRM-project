import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { AppError } from "../common/errors";
import type { Services } from "../container";
import type { Router } from "../http/router";
import type { InboundEmail, WebhooksService } from "./webhooks.service";

export function webhooksRoutes(router: Router, s: Services) {
  router.group("/v1/webhooks", { public: true }, (r) => {
    /** Meta's subscription handshake. */
    r.get("meta", { throttle: false }, ({ search }) => {
      const token = config().META_VERIFY_TOKEN;
      if (!token || search.get("hub.mode") !== "subscribe" || search.get("hub.verify_token") !== token) {
        throw new AppError("FORBIDDEN", "Verification failed");
      }
      return search.get("hub.challenge") ?? "";
    });

    /** Inbound email (provider webhook); authorised by the channel's secret token in the URL. */
    r.post("email/:channelId", { status: 200 }, ({ params, search, body }) =>
      s.webhooks.processEmail(params.channelId!, search.get("token") ?? "", (body ?? {}) as InboundEmail),
    );

    /** Deliveries are accepted only with a valid X-Hub-Signature-256 over the raw body. */
    r.post("meta", { throttle: false, status: 200 }, ({ req, raw, body }) => {
      const secret = config().META_APP_SECRET;
      const header = req.headers.get("x-hub-signature-256") ?? "";
      if (!secret || !raw.length) throw new AppError("FORBIDDEN", "Webhooks are not configured");
      const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
      const given = Buffer.from(header);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AppError("FORBIDDEN", "Invalid signature");
      return s.webhooks.processMeta(raw, body as Parameters<WebhooksService["processMeta"]>[1]);
    });
  });
}
