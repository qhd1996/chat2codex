import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";

import type { OutboundMediaInput } from "../../core/actions.js";
import type { Logger } from "../../util/logger.js";
import type {
  WeixinGetUploadUrlRequest,
  WeixinGetUploadUrlResponse,
  WeixinGetUpdatesResponse,
  WeixinMessage,
} from "./types.js";
import {
  WeixinItemType,
  WeixinMessageState,
  WeixinMessageType,
  WeixinUploadMediaType,
} from "./types.js";

const defaultApiTimeoutMs = 15_000;
const defaultLongPollTimeoutMs = 35_000;

export interface WeixinApiClientOptions {
  baseUrl: string;
  token?: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  randomBytesImpl?: (size: number) => Buffer;
}

export class WeixinApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly randomBytesImpl: (size: number) => Buffer;

  constructor(private readonly options: WeixinApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.randomBytesImpl = options.randomBytesImpl ?? crypto.randomBytes;
  }

  async getUpdates(
    getUpdatesBuf: string,
    timeoutMs = defaultLongPollTimeoutMs,
    abortSignal?: AbortSignal,
  ): Promise<WeixinGetUpdatesResponse> {
    try {
      return await this.postJson<WeixinGetUpdatesResponse>(
        "ilink/bot/getupdates",
        {
          get_updates_buf: getUpdatesBuf,
          base_info: baseInfo(),
        },
        timeoutMs,
        abortSignal,
      );
    } catch (error) {
      if (isAbortError(error)) {
        return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
      }
      throw error;
    }
  }

  async sendText(params: {
    to: string;
    text: string;
    contextToken?: string;
    clientId: string;
  }): Promise<void> {
    const message: WeixinMessage = {
      from_user_id: "",
      to_user_id: params.to,
      message_type: WeixinMessageType.BOT,
      message_state: WeixinMessageState.FINISH,
      context_token: params.contextToken,
      item_list: [
        {
          type: WeixinItemType.TEXT,
          text_item: { text: params.text },
        },
      ],
    };
    const response = await this.postJson<{ ret?: number; errmsg?: string }>(
      "ilink/bot/sendmessage",
      {
        msg: { ...message, client_id: params.clientId },
        base_info: baseInfo(),
      },
      defaultApiTimeoutMs,
    );
    assertApiSuccess("sendMessage", response);
  }

  async sendMedia(params: {
    to: string;
    input: OutboundMediaInput;
    contextToken?: string;
    clientId: string;
    timeoutMs?: number;
  }): Promise<void> {
    const timeoutMs = params.timeoutMs ?? defaultApiTimeoutMs;
    const plaintext = await readVerifiedStagedMedia(params.input);
    let fileKeyBytes: Buffer | undefined;
    let aesKey: Buffer | undefined;
    let ciphertext: Buffer | undefined;
    try {
      fileKeyBytes = this.randomBytes(16, "file key");
      aesKey = this.randomBytes(16, "AES key");
      const fileKey = fileKeyBytes.toString("hex");
      const rawMd5 = crypto.createHash("md5").update(plaintext).digest("hex");
      ciphertext = encryptAes128Ecb(plaintext, aesKey);
      const uploadRequest: WeixinGetUploadUrlRequest = {
        filekey: fileKey,
        media_type: params.input.kind === "image"
          ? WeixinUploadMediaType.IMAGE
          : WeixinUploadMediaType.FILE,
        to_user_id: params.to,
        rawsize: plaintext.byteLength,
        rawfilemd5: rawMd5,
        filesize: ciphertext.byteLength,
        no_need_thumb: true,
        aeskey: aesKey.toString("hex"),
      };
      const uploadResponse = await this.postJson<WeixinGetUploadUrlResponse>(
        "ilink/bot/getuploadurl",
        { ...uploadRequest, base_info: baseInfo() },
        timeoutMs,
      );
      assertApiSuccess("getUploadUrl", uploadResponse);
      const uploadUrl = resolveUploadUrl(uploadResponse, fileKey);
      const downloadParam = await this.uploadEncryptedMedia(
        uploadUrl,
        ciphertext,
        timeoutMs,
      );
      const media = {
        encrypt_query_param: downloadParam,
        aes_key: aesKey.toString("base64"),
        encrypt_type: 1,
      };
      const item = params.input.kind === "image"
        ? {
            type: WeixinItemType.IMAGE,
            image_item: { media, mid_size: ciphertext.byteLength },
          }
        : {
            type: WeixinItemType.FILE,
            file_item: {
              media,
              file_name: sanitizeOutboundFileName(params.input.fileName),
              len: String(plaintext.byteLength),
            },
          };
      const response = await this.postJson<{ ret?: number; errcode?: number; errmsg?: string }>(
        "ilink/bot/sendmessage",
        {
          msg: {
            from_user_id: "",
            to_user_id: params.to,
            message_type: WeixinMessageType.BOT,
            message_state: WeixinMessageState.FINISH,
            context_token: params.contextToken,
            item_list: [item],
            client_id: params.clientId,
          },
          base_info: baseInfo(),
        },
        timeoutMs,
      );
      assertApiSuccess("sendMessage", response);
    } finally {
      plaintext.fill(0);
      ciphertext?.fill(0);
      aesKey?.fill(0);
      fileKeyBytes?.fill(0);
    }
  }

  async getTypingTicket(
    userId: string,
    contextToken?: string,
  ): Promise<string | undefined> {
    const response = await this.postJson<{
      ret?: number;
      errmsg?: string;
      typing_ticket?: string;
    }>(
      "ilink/bot/getconfig",
      {
        ilink_user_id: userId,
        context_token: contextToken,
        base_info: baseInfo(),
      },
      10_000,
    );
    assertApiSuccess("getConfig", response);
    return response.typing_ticket?.trim() || undefined;
  }

  async sendTyping(
    userId: string,
    typingTicket: string,
    status: 1 | 2,
  ): Promise<void> {
    const response = await this.postJson<{ ret?: number; errmsg?: string }>(
      "ilink/bot/sendtyping",
      {
        ilink_user_id: userId,
        typing_ticket: typingTicket,
        status,
        base_info: baseInfo(),
      },
      10_000,
    );
    assertApiSuccess("sendTyping", response);
  }

  async notifyStart(): Promise<void> {
    const response = await this.postJson<{ ret?: number; errmsg?: string }>(
      "ilink/bot/msg/notifystart",
      { base_info: baseInfo() },
      10_000,
    );
    assertApiSuccess("notifyStart", response);
  }

  async notifyStop(): Promise<void> {
    const response = await this.postJson<{ ret?: number; errmsg?: string }>(
      "ilink/bot/msg/notifystop",
      { base_info: baseInfo() },
      10_000,
    );
    assertApiSuccess("notifyStop", response);
  }

  async getJson<T>(
    endpoint: string,
    timeoutMs: number,
    baseUrl = this.options.baseUrl,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(new URL(endpoint, trailingSlash(baseUrl)), {
        method: "GET",
        headers: commonHeaders(false),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Weixin GET failed with HTTP ${response.status}.`);
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async postJson<T>(
    endpoint: string,
    body: unknown,
    timeoutMs: number,
    abortSignal?: AbortSignal,
    baseUrl = this.options.baseUrl,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    abortSignal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.fetchImpl(new URL(endpoint, trailingSlash(baseUrl)), {
        method: "POST",
        headers: commonHeaders(Boolean(this.options.token), this.options.token),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Weixin POST failed with HTTP ${response.status}.`);
      }
      return JSON.parse(text) as T;
    } catch (error) {
      if (timedOut && isAbortError(error)) {
        this.options.logger.warn("Weixin API request timed out", { endpoint });
        const timeoutError = new Error("Weixin API request timed out.");
        timeoutError.name = "AbortError";
        throw timeoutError;
      }
      if (!isAbortError(error)) {
        this.options.logger.warn("Weixin API request failed", {
          endpoint,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", abort);
    }
  }

  private randomBytes(size: number, label: string): Buffer {
    const value = this.randomBytesImpl(size);
    if (!Buffer.isBuffer(value) || value.byteLength !== size) {
      throw new Error("Weixin random " + label + " must contain exactly " + size + " bytes.");
    }
    return Buffer.from(value);
  }

  private async uploadEncryptedMedia(
    uploadUrl: URL,
    ciphertext: Buffer,
    timeoutMs: number,
  ): Promise<string> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await this.fetchImpl(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error("Weixin CDN upload failed with HTTP " + response.status + ".");
      }
      const downloadParam = response.headers.get("x-encrypted-param")?.trim();
      if (!downloadParam) {
        throw new Error("Weixin CDN upload response is missing x-encrypted-param.");
      }
      return downloadParam;
    } catch (error) {
      if (timedOut && isAbortError(error)) {
        throw new Error("Weixin CDN upload timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readVerifiedStagedMedia(input: OutboundMediaInput): Promise<Buffer> {
  if (input.kind !== "image" && input.kind !== "file") {
    throw new Error("Invalid staged media kind.");
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || !/^[a-f0-9]{64}$/u.test(input.sha256)) {
    throw new Error("Invalid staged media metadata.");
  }
  if (input.kind === "image" && !input.mediaType.startsWith("image/")) {
    throw new Error("Invalid staged image media type.");
  }
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(input.stagedPath, flags);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== input.size) {
      throw new Error("The staged media snapshot changed before upload.");
    }
    const bytes = await handle.readFile();
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== input.size || sha256 !== input.sha256) {
      bytes.fill(0);
      throw new Error("The staged media snapshot changed before upload.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function encryptAes128Ecb(plaintext: Buffer, key: Buffer): Buffer {
  if (key.byteLength !== 16) {
    throw new Error("Weixin outbound AES key must contain exactly 16 bytes.");
  }
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

function resolveUploadUrl(response: WeixinGetUploadUrlResponse, fileKey: string): URL {
  const full = response.upload_full_url?.trim();
  const candidate = full || (response.upload_param
    ? "https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=" + encodeURIComponent(response.upload_param) + "&filekey=" + encodeURIComponent(fileKey)
    : "");
  if (!candidate) {
    throw new Error("getUploadUrl returned no upload URL.");
  }
  const url = new URL(candidate);
  if (url.protocol !== "https:") {
    throw new Error("Weixin CDN upload URL must use HTTPS.");
  }
  return url;
}

function sanitizeOutboundFileName(value: string): string {
  const base = value.replaceAll("\\", "/").split("/").pop()?.normalize("NFKC") ?? "";
  let safe = base.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, "_")
    .replace(/[. ]+$/gu, "")
    .trim();
  if (!safe || safe === "." || safe === "..") safe = "deliverable.bin";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/iu.test(safe)) safe = "_" + safe;
  if (safe.length > 160) {
    const extensionIndex = safe.lastIndexOf(".");
    const extension = extensionIndex > 0 ? safe.slice(extensionIndex, extensionIndex + 21) : "";
    safe = safe.slice(0, 160 - extension.length) + extension;
  }
  return safe;
}

export const weixinApiInternals = {
  aesPaddedSize,
  encryptAes128Ecb,
  sanitizeOutboundFileName,
};

function baseInfo() {
  return {
    channel_version: "0.7.0",
    bot_agent: "Chat2Codex/0.7.0",
  };
}

function commonHeaders(
  authenticated: boolean,
  token?: string,
): Record<string, string> {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": String(0x000700),
    "X-WECHAT-UIN": Buffer.from(String(uint32), "utf8").toString("base64"),
    ...(authenticated && token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : {}),
  };
}

function assertApiSuccess(
  label: string,
  response: { ret?: number; errcode?: number; errmsg?: string },
): void {
  if (
    (response.ret !== undefined && response.ret !== 0) ||
    (response.errcode !== undefined && response.errcode !== 0)
  ) {
    throw new Error(
      `${label} failed: ret=${response.ret ?? "?"} errcode=${response.errcode ?? "?"}`,
    );
  }
}

function trailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
