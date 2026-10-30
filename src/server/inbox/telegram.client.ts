import { config } from "../config";
import { AppError } from "../common/errors";
import { Logger } from "../common/logger";

export interface OutgoingFile {
  buffer: Buffer;
  name: string;
  mimeType: string;
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Telegram Bot API (official HTTPS endpoints only). The bot token is the credential;
 * tests point TELEGRAM_API_URL at a local fake.
 */
export class TelegramClient {
  private readonly logger = new Logger("Telegram");

  getMe(token: string) {
    return this.call<{ id: number; username?: string; first_name: string }>(token, "getMe", {});
  }

  /** Webhook with a secret Telegram repeats in X-Telegram-Bot-Api-Secret-Token on every delivery. */
  setWebhook(token: string, url: string, secret: string) {
    return this.call<boolean>(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: false });
  }

  deleteWebhook(token: string) {
    return this.call<boolean>(token, "deleteWebhook", {});
  }

  async sendMessage(token: string, chatId: string, text: string) {
    const m = await this.call<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text });
    return String(m.message_id);
  }

  /** Images go as photos (shown inline), everything else as a document. */
  async sendFile(token: string, chatId: string, file: OutgoingFile, caption?: string) {
    const photo = PHOTO_TYPES.has(file.mimeType) && file.buffer.length < 10 * 1024 * 1024;
    const form = new FormData();
    form.set("chat_id", chatId);
    if (caption) form.set("caption", caption.slice(0, 1024));
    form.set(photo ? "photo" : "document", new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.name);
    const m = await this.request<{ message_id: number }>(token, photo ? "sendPhoto" : "sendDocument", form);
    return String(m.message_id);
  }

  /** A file a customer sent, up to `maxBytes` (the Bot API serves files up to 20 MB). */
  async download(token: string, fileId: string, maxBytes: number) {
    const f = await this.call<{ file_path?: string; file_size?: number }>(token, "getFile", { file_id: fileId });
    if (!f.file_path) throw new AppError("CHANNEL_ERROR", "Telegram has no download for this file");
    if (f.file_size && f.file_size > maxBytes) throw new AppError("FILE_TOO_LARGE", "File too large");
    const res = await fetch(`${config().TELEGRAM_API_URL}/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new AppError("CHANNEL_ERROR", `Telegram file download failed (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new AppError("FILE_TOO_LARGE", "File too large");
    return buffer;
  }

  private call<T>(token: string, method: string, params: Record<string, unknown>) {
    return this.request<T>(token, method, JSON.stringify(params));
  }

  private async request<T>(token: string, method: string, body: string | FormData): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config().TELEGRAM_API_URL}/bot${token}/${method}`, {
        method: "POST",
        headers: typeof body === "string" ? { "content-type": "application/json" } : undefined,
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new AppError("CHANNEL_ERROR", "Telegram is unreachable", { reason: String(e) });
    }
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
    if (!json.ok) {
      // The token is part of the URL: never log the URL itself
      this.logger.warn(`Telegram ${method} failed: ${json.error_code} ${json.description}`);
      throw new AppError("CHANNEL_ERROR", json.description ?? `Telegram error ${res.status}`, { providerCode: json.error_code });
    }
    return json.result as T;
  }
}
