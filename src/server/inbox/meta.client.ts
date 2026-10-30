import { Logger } from "../common/logger";
import { config } from "../config";
import { AppError } from "../common/errors";
import type { OutgoingFile } from "./telegram.client";

/**
 * Outbound calls to Meta's Graph API (official endpoints only):
 * - WhatsApp Cloud API: POST /{phone-number-id}/messages
 * - Messenger / Instagram: POST /me/messages with the page/account token
 * Tests point META_GRAPH_URL at a local fake; production uses graph.facebook.com.
 */
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

  /** Uploads the file to WhatsApp, then sends it as an image or a document. */
  async sendWhatsAppMedia(phoneNumberId: string, accessToken: string, to: string, file: OutgoingFile, caption?: string): Promise<string> {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", file.mimeType);
    form.set("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.name);
    const uploaded = (await this.post(`/${phoneNumberId}/media`, accessToken, form)) as { id?: string };
    if (!uploaded.id) throw new AppError("CHANNEL_ERROR", "WhatsApp did not accept the file");
    const image = file.mimeType === "image/jpeg" || file.mimeType === "image/png";
    const res = await this.post(`/${phoneNumberId}/messages`, accessToken, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: image ? "image" : "document",
      [image ? "image" : "document"]: { id: uploaded.id, ...(caption ? { caption: caption.slice(0, 1024) } : {}), ...(image ? {} : { filename: file.name }) },
    });
    return (res as { messages?: { id: string }[] }).messages?.[0]?.id ?? "";
  }

  /** Business-initiated message: an approved template with its body parameters. */
  async sendWhatsAppTemplate(phoneNumberId: string, accessToken: string, to: string, name: string, language: string, params: string[]): Promise<string> {
    const res = await this.post(`/${phoneNumberId}/messages`, accessToken, {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: language },
        ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}),
      },
    });
    return (res as { messages?: { id: string }[] }).messages?.[0]?.id ?? "";
  }

  /** Approved templates of a WhatsApp Business Account. */
  async listTemplates(wabaId: string, accessToken: string) {
    const res = (await this.get(`/${wabaId}/message_templates?status=APPROVED&limit=100`, accessToken)) as {
      data?: { name: string; language: string; status: string; components?: { type: string; text?: string }[] }[];
    };
    return (res.data ?? [])
      .filter((t) => t.status === "APPROVED")
      .map((t) => {
        const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
        return { name: t.name, language: t.language, body, params: new Set(body.match(/\{\{\d+\}\}/g) ?? []).size };
      });
  }

  /** A file a customer sent: its URL comes from the media id and is fetched with the token. */
  async downloadWhatsAppMedia(accessToken: string, mediaId: string, maxBytes: number) {
    const meta = (await this.get(`/${mediaId}`, accessToken)) as { url?: string; mime_type?: string; file_size?: number };
    if (!meta.url) throw new AppError("CHANNEL_ERROR", "WhatsApp has no download for this file");
    if (meta.file_size && meta.file_size > maxBytes) throw new AppError("FILE_TOO_LARGE", "File too large");
    const res = await fetch(meta.url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new AppError("CHANNEL_ERROR", `WhatsApp media download failed (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new AppError("FILE_TOO_LARGE", "File too large");
    return { buffer, mimeType: meta.mime_type ?? "application/octet-stream" };
  }

  private get(path: string, accessToken: string) {
    return this.request(path, accessToken, { method: "GET" });
  }

  private post(path: string, accessToken: string, payload: unknown) {
    return payload instanceof FormData
      ? this.request(path, accessToken, { method: "POST", body: payload })
      : this.request(path, accessToken, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } });
  }

  private async request(path: string, accessToken: string, init: RequestInit) {
    let res: Response;
    try {
      res = await fetch(`${config().META_GRAPH_URL}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30_000),
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
