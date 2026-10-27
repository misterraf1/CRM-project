import { Injectable, Logger } from "@nestjs/common";
import { config } from "../config";
import { AppError } from "../common/errors";

/**
 * Outbound calls to Meta's Graph API (official endpoints only):
 * - WhatsApp Cloud API: POST /{phone-number-id}/messages
 * - Messenger / Instagram: POST /me/messages with the page/account token
 * Tests point META_GRAPH_URL at a local fake; production uses graph.facebook.com.
 */
@Injectable()
export class MetaClient {
  private readonly logger = new Logger("MetaClient");

  async sendWhatsApp(phoneNumberId: string, accessToken: string, to: string, body: string): Promise<string> {
    const res = await this.post(`/${phoneNumberId}/messages`, accessToken, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    });
    return (res as { messages?: { id: string }[] }).messages?.[0]?.id ?? "";
  }

  async sendPageMessage(accessToken: string, recipientId: string, body: string): Promise<string> {
    const res = await this.post("/me/messages", accessToken, {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: body },
    });
    return (res as { message_id?: string }).message_id ?? "";
  }

  private async post(path: string, accessToken: string, payload: unknown) {
    let res: Response;
    try {
      res = await fetch(`${config().META_GRAPH_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new AppError("CHANNEL_ERROR", "Messaging provider is unreachable", { reason: String(e) });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (json as { error?: { message?: string; code?: number } }).error;
      this.logger.warn(`Graph API ${res.status}: ${err?.message}`);
      throw new AppError("CHANNEL_ERROR", err?.message ?? `Provider error ${res.status}`, { providerCode: err?.code });
    }
    return json;
  }
}
