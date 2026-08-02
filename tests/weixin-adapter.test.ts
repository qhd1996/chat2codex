import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { WeixinApiClient, weixinApiInternals } from "../src/adapters/weixin/api.js";
import { createWeixinAdapter, weixinAdapterInternals } from "../src/adapters/weixin/adapter.js";
import {
  loadWeixinCredentials,
  loadWeixinRuntime,
  saveWeixinCredentials,
  saveWeixinRuntime,
} from "../src/adapters/weixin/store.js";
import { emptyWeixinRuntimeState } from "../src/adapters/weixin/types.js";
import { loadConfig } from "../src/config/env.js";
import { weixinSetupInternals } from "../src/setup/weixin.js";
import type { Logger } from "../src/util/logger.js";
import { expectPrivateFileMode } from "./helpers/platform.js";

const temporaryDirectories: string[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const tencent246Fixture = {
  plaintext: Buffer.from("phase2 fixture"),
  aesKey: Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"),
  ciphertextHex: "6b070c645a2d34211cdd17bcc0e7c0ce",
  md5Hex: "c3928f8b905a849b8a40226b93efbe2b",
  fileKey: "101112131415161718191a1b1c1d1e1f",
  downloadParam: "download-opaque",
} as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Weixin protocol adapter", () => {
  test("preserves logical lines in plain text without rewriting Markdown answers", () => {
    expect(
      weixinAdapterInternals.renderWeixinView({
        kind: "text",
        text: "Chat2Codex 状态\n\n【会话】\n• 工作目录：/repo\n• Thread：尚未创建",
      }),
    ).toBe(
      "Chat2Codex 状态\n\n【会话】\n\n• 工作目录：/repo\n\n• Thread：尚未创建",
    );
    expect(
      weixinAdapterInternals.renderWeixinView({
        kind: "markdown",
        markdown: "**结果**\n\n- 第一项\n- 第二项",
      }),
    ).toBe("**结果**\n\n- 第一项\n- 第二项");
  });

  test("maps private text and attachments to stable iLink identity", () => {
    const runtime = emptyWeixinRuntimeState();
    const events = weixinAdapterInternals.adaptWeixinMessage(
      {
        message_id: "m-1",
        from_user_id: "wx-user",
        context_token: "sensitive-context",
        item_list: [
          { type: 1, text_item: { text: "run tests" } },
          {
            type: 2,
            image_item: {
              aeskey: "00112233445566778899aabbccddeeff",
              media: { encrypt_query_param: "opaque" },
            },
          },
          {
            type: 4,
            file_item: {
              file_name: "../../report.txt",
              media: {
                encrypt_query_param: "file-query",
                aes_key: Buffer.alloc(16, 7).toString("base64"),
              },
            },
          },
        ],
      },
      "weixin:bot-1",
      runtime,
      24,
    );

    expect(events[0]).toMatchObject({
      kind: "diagnostic",
      outcome: "routed",
      attachmentCount: 2,
    });
    expect(events[1]).toMatchObject({
      kind: "message",
      conversation: { conversationId: "wx-user", kind: "direct" },
      sender: {
        keys: [{ kind: "ilink_user_id", value: "wx-user" }],
      },
      text: "run tests",
      attachments: [
        { attachmentId: "m-1:1", kind: "image" },
        { attachmentId: "m-1:2", kind: "file", name: "report.txt" },
      ],
    });
    expect(runtime.conversations["wx-user"]?.contextToken).toBe(
      "sensitive-context",
    );
  });

  test("drops groups and unsupported media with diagnostics", () => {
    const groupEvents = weixinAdapterInternals.adaptWeixinMessage(
      {
        message_id: "g-1",
        from_user_id: "wx-user",
        group_id: "group",
        item_list: [{ type: 1, text_item: { text: "ignored" } }],
      },
      "weixin:bot",
      emptyWeixinRuntimeState(),
      24,
    );
    expect(groupEvents).toEqual([
      expect.objectContaining({
        kind: "diagnostic",
        outcome: "dropped",
        reason: "weixin_group_unsupported",
      }),
    ]);

    const voiceEvents = weixinAdapterInternals.adaptWeixinMessage(
      {
        message_id: "v-1",
        from_user_id: "wx-user",
        item_list: [{ type: 3, voice_item: { text: "transcript" } }],
      },
      "weixin:bot",
      emptyWeixinRuntimeState(),
      24,
    );
    expect(voiceEvents).toEqual([
      expect.objectContaining({
        outcome: "dropped",
        reason: "weixin_media_unsupported",
      }),
    ]);
  });

  test("commits the sync cursor only after the complete batch reaches core", async () => {
    const message = {
      message_id: "cursor-message",
      from_user_id: "wx-user",
      item_list: [{ type: 1, text_item: { text: "hello" } }],
    };
    const failedRuntime = emptyWeixinRuntimeState();
    const failedController = new AbortController();
    const api = {
      async getUpdates() {
        return {
          ret: 0,
          msgs: [message],
          get_updates_buf: "cursor-after-batch",
        };
      },
    } as unknown as WeixinApiClient;
    await weixinAdapterInternals.pollWeixin(
      api,
      failedRuntime,
      async (event) => {
        if (event.kind === "message") {
          failedController.abort();
          throw new Error("core persistence failed");
        }
      },
      "weixin:bot",
      async () => undefined,
      logger,
      failedController.signal,
      24,
    );
    expect(failedRuntime.getUpdatesBuf).toBe("");

    const succeededRuntime = emptyWeixinRuntimeState();
    const succeededController = new AbortController();
    await weixinAdapterInternals.pollWeixin(
      api,
      succeededRuntime,
      async (event) => {
        if (event.kind === "message") {
          succeededController.abort();
        }
      },
      "weixin:bot",
      async () => undefined,
      logger,
      succeededController.signal,
      24,
    );
    expect(succeededRuntime.getUpdatesBuf).toBe("cursor-after-batch");
  });

  test("keeps an ordinary long-poll timeout as an empty update batch", async () => {
    const client = new WeixinApiClient({
      baseUrl: "https://api.example.test",
      token: "bot-secret",
      logger,
      fetchImpl: async (_request, init) => {
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
        });
        throw new Error("unreachable");
      },
    });

    await expect(client.getUpdates("cursor-before-timeout", 10)).resolves.toEqual({
      ret: 0,
      msgs: [],
      get_updates_buf: "cursor-before-timeout",
    });
  });

  test("passes context and idempotency key in outbound requests without logging secrets", async () => {
    const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
    const client = new WeixinApiClient({
      baseUrl: "https://example.test",
      token: "bot-secret",
      logger,
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as unknown,
        });
        return Response.json({ ret: 0 });
      },
    });
    await client.sendText({
      to: "wx-user",
      text: "done",
      contextToken: "context-secret",
      clientId: "outbox-key",
    });

    expect(requests[0]?.url).toEndWith("/ilink/bot/sendmessage");
    expect(requests[0]?.headers.get("Authorization")).toBe(
      "Bearer bot-secret",
    );
    expect(requests[0]?.body).toMatchObject({
      msg: {
        client_id: "outbox-key",
        context_token: "context-secret",
        to_user_id: "wx-user",
      },
    });
  });

  test("encrypts outbound media with the pinned AES-128-ECB PKCS#7 fixture", () => {
    expect(
      weixinApiInternals.encryptAes128Ecb(
        tencent246Fixture.plaintext,
        tencent246Fixture.aesKey,
      ).toString("hex"),
    ).toBe(tencent246Fixture.ciphertextHex);
    expect(weixinApiInternals.aesPaddedSize(tencent246Fixture.plaintext.length)).toBe(16);
    expect(weixinApiInternals.aesPaddedSize(16)).toBe(32);
  });

  test("uploads and sends one native outbound image with exact Tencent 2.4.6 fields", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chat2codex-weixin-upload-"));
    temporaryDirectories.push(directory);
    const stagedPath = path.join(directory, "answer.png");
    await fs.writeFile(stagedPath, tencent246Fixture.plaintext);
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const randomValues = [Buffer.from(tencent246Fixture.fileKey, "hex"), tencent246Fixture.aesKey];
    const client = new WeixinApiClient({
      baseUrl: "https://api.example.test",
      token: "bot-secret",
      logger,
      randomBytesImpl: () => Buffer.from(randomValues.shift()!),
      fetchImpl: async (input, init) => {
        const url = String(input);
        const bytes = init?.body instanceof Uint8Array ? Buffer.from(init.body) : undefined;
        requests.push({
          url,
          method: init?.method ?? "GET",
          body: bytes ?? JSON.parse(String(init?.body)) as unknown,
        });
        if (url.endsWith("/ilink/bot/getuploadurl")) {
          return Response.json({ ret: 0, upload_full_url: "https://cdn.example.test/upload?signed=private" });
        }
        if (url.startsWith("https://cdn.example.test/upload")) {
          return new Response(null, { status: 200, headers: { "x-encrypted-param": tencent246Fixture.downloadParam } });
        }
        return Response.json({ ret: 0 });
      },
    });

    await client.sendMedia({
      to: "wx-user",
      input: {
        kind: "image",
        stagedPath,
        fileName: "answer.png",
        mediaType: "image/png",
        size: tencent246Fixture.plaintext.length,
        sha256: crypto.createHash("sha256").update(tencent246Fixture.plaintext).digest("hex"),
      },
      contextToken: "context-secret",
      clientId: "stable-delivery-id",
    });

    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      url: "https://api.example.test/ilink/bot/getuploadurl",
      method: "POST",
      body: {
        filekey: tencent246Fixture.fileKey,
        media_type: 1,
        to_user_id: "wx-user",
        rawsize: 14,
        rawfilemd5: tencent246Fixture.md5Hex,
        filesize: 16,
        no_need_thumb: true,
        aeskey: tencent246Fixture.aesKey.toString("hex"),
      },
    });
    expect(requests[1]).toMatchObject({
      url: "https://cdn.example.test/upload?signed=private",
      method: "POST",
    });
    expect(Buffer.isBuffer(requests[1]?.body) && requests[1].body.toString("hex")).toBe(
      tencent246Fixture.ciphertextHex,
    );
    expect(requests[2]).toMatchObject({
      url: "https://api.example.test/ilink/bot/sendmessage",
      method: "POST",
      body: {
        msg: {
          client_id: "stable-delivery-id",
          context_token: "context-secret",
          to_user_id: "wx-user",
          item_list: [{
            type: 2,
            image_item: {
              media: {
                encrypt_query_param: tencent246Fixture.downloadParam,
                aes_key: Buffer.from(
                  tencent246Fixture.aesKey.toString("hex"),
                  "utf8",
                ).toString("base64"),
                encrypt_type: 1,
              },
              mid_size: 16,
            },
          }],
        },
      },
    });
  });

  test("sends a native outbound file with sanitized name and stable client ID", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chat2codex-weixin-file-"));
    temporaryDirectories.push(directory);
    const credentialsPath = path.join(directory, "credentials.json");
    const stagedPath = path.join(directory, "report.bin");
    await fs.writeFile(stagedPath, tencent246Fixture.plaintext);
    await saveWeixinCredentials(credentialsPath, {
      schemaVersion: 1,
      accountId: "clawbot",
      token: "bot-secret",
      baseUrl: "https://api.example.test",
      savedAt: new Date().toISOString(),
    });
    await saveWeixinRuntime(path.join(directory, "runtime.json"), {
      ...emptyWeixinRuntimeState(),
      conversations: {
        "wx-user": { contextToken: "context-secret", updatedAt: new Date().toISOString() },
      },
    });
    const sentMessages: unknown[] = [];
    const randomValues = [Buffer.alloc(16, 0x20), Buffer.alloc(16, 0x30)];
    const adapter = await createWeixinAdapter(
      loadConfig({ CHAT2CODEX_ADAPTER: "weixin", CODEX_WORKDIR: directory, WEIXIN_CREDENTIALS_PATH: credentialsPath }),
      logger,
      {
        randomBytesImpl: () => Buffer.from(randomValues.shift()!),
        fetchImpl: async (input, init) => {
          const url = String(input);
          if (url.endsWith("/ilink/bot/getuploadurl")) {
            return Response.json({ ret: 0, upload_param: "upload-opaque" });
          }
          if (url.startsWith("https://novac2c.cdn.weixin.qq.com/c2c/upload")) {
            return new Response(null, { status: 200, headers: { "x-encrypted-param": "download-file" } });
          }
          sentMessages.push(JSON.parse(String(init?.body)) as unknown);
          return Response.json({ ret: 0 });
        },
      },
    );
    const result = await adapter.sendMedia!(
      { adapterId: "weixin:clawbot", conversationId: "wx-user" },
      {
        kind: "file",
        stagedPath,
        fileName: "../../report?.txt",
        mediaType: "application/octet-stream",
        size: tencent246Fixture.plaintext.length,
        sha256: crypto.createHash("sha256").update(tencent246Fixture.plaintext).digest("hex"),
      },
      { idempotencyKey: "stable-file-delivery" },
    );

    expect(result).toMatchObject({
      status: "delivered",
      handle: { messageId: "stable-file-delivery" },
    });
    expect(sentMessages).toEqual([
      expect.objectContaining({
        msg: expect.objectContaining({
          client_id: "stable-file-delivery",
          context_token: "context-secret",
          item_list: [{
            type: 4,
            file_item: expect.objectContaining({
              file_name: "report_.txt",
              len: "14",
              media: expect.objectContaining({
                encrypt_query_param: "download-file",
                encrypt_type: 1,
              }),
            }),
          }],
        }),
      }),
    ]);
  });

  test("fails closed on upload errors, timeouts, or changed staged bytes without leaking secrets", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chat2codex-weixin-fail-"));
    temporaryDirectories.push(directory);
    const stagedPath = path.join(directory, "changed.bin");
    await fs.writeFile(stagedPath, tencent246Fixture.plaintext);
    const logLines: string[] = [];
    const capturingLogger: Logger = {
      debug(message, data) { logLines.push(String(message) + " " + JSON.stringify(data)); },
      info(message, data) { logLines.push(String(message) + " " + JSON.stringify(data)); },
      warn(message, data) { logLines.push(String(message) + " " + JSON.stringify(data)); },
      error(message, data) { logLines.push(String(message) + " " + JSON.stringify(data)); },
    };
    const client = new WeixinApiClient({
      baseUrl: "https://api.example.test",
      token: "bot-secret-never-log",
      logger: capturingLogger,
      randomBytesImpl: () => Buffer.from("00112233445566778899aabbccddeeff", "hex"),
      fetchImpl: async (_input, init) => {
        const signal = init?.signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("key=00112233445566778899aabbccddeeff"), { name: "AbortError" })), { once: true });
        });
        throw new Error("unreachable");
      },
    });
    const input = {
      kind: "file" as const,
      stagedPath,
      fileName: "changed.bin",
      mediaType: "application/octet-stream",
      size: tencent246Fixture.plaintext.length,
      sha256: crypto.createHash("sha256").update(tencent246Fixture.plaintext).digest("hex"),
    };
    await fs.appendFile(stagedPath, "changed");
    await expect(client.sendMedia({ to: "wx-user", input, clientId: "stable", timeoutMs: 10 })).rejects.toThrow("staged media");
    await fs.writeFile(stagedPath, tencent246Fixture.plaintext);
    await expect(client.sendMedia({ to: "wx-user", input, clientId: "stable", timeoutMs: 10 })).rejects.toThrow("timed out");

    const syntheticNetworkSecret = "network-key=ffeeddccbbaa99887766554433221100";
    const failingClient = new WeixinApiClient({
      baseUrl: "https://api.example.test",
      token: "bot-secret-never-log",
      logger: capturingLogger,
      randomBytesImpl: () => Buffer.from("00112233445566778899aabbccddeeff", "hex"),
      fetchImpl: async () => {
        throw new Error(syntheticNetworkSecret);
      },
    });
    await expect(
      failingClient.sendMedia({ to: "wx-user", input, clientId: "stable" }),
    ).rejects.toThrow("Weixin API request failed.");
    const renderedLogs = logLines.join("\n");
    expect(renderedLogs).not.toContain("bot-secret-never-log");
    expect(renderedLogs).not.toContain("00112233445566778899aabbccddeeff");
    expect(renderedLogs).not.toContain(syntheticNetworkSecret);
  });

  test("rejects failed upload responses before any native media message is sent", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chat2codex-weixin-response-"));
    temporaryDirectories.push(directory);
    const stagedPath = path.join(directory, "response.bin");
    await fs.writeFile(stagedPath, tencent246Fixture.plaintext);
    const input = {
      kind: "file" as const,
      stagedPath,
      fileName: "response.bin",
      mediaType: "application/octet-stream",
      size: tencent246Fixture.plaintext.length,
      sha256: crypto.createHash("sha256").update(tencent246Fixture.plaintext).digest("hex"),
    };
    let sendMessageCalls = 0;
    const client = new WeixinApiClient({
      baseUrl: "https://api.example.test",
      token: "bot-secret",
      logger,
      randomBytesImpl: () => Buffer.alloc(16, 7),
      fetchImpl: async (request) => {
        const url = String(request);
        if (url.endsWith("/ilink/bot/getuploadurl")) {
          return Response.json({ ret: 0, upload_full_url: "https://cdn.example.test/upload" });
        }
        if (url.endsWith("/ilink/bot/sendmessage")) sendMessageCalls += 1;
        return new Response("rejected", { status: 403 });
      },
    });

    await expect(client.sendMedia({ to: "wx-user", input, clientId: "stable" }))
      .rejects.toThrow("HTTP 403");
    expect(sendMessageCalls).toBe(0);
  });

  test("may request a fresh upload URL on retry but preserves the delivery client ID", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chat2codex-weixin-retry-"));
    temporaryDirectories.push(directory);
    const stagedPath = path.join(directory, "retry.bin");
    await fs.writeFile(stagedPath, tencent246Fixture.plaintext);
    const input = {
      kind: "file" as const,
      stagedPath,
      fileName: "retry.bin",
      mediaType: "application/octet-stream",
      size: tencent246Fixture.plaintext.length,
      sha256: crypto.createHash("sha256").update(tencent246Fixture.plaintext).digest("hex"),
    };
    const uploadUrls: string[] = [];
    const clientIds: string[] = [];
    let uploadUrlAttempt = 0;
    const client = new WeixinApiClient({
      baseUrl: "https://api.example.test",
      token: "bot-secret",
      logger,
      randomBytesImpl: () => Buffer.alloc(16, uploadUrlAttempt + 1),
      fetchImpl: async (request, init) => {
        const url = String(request);
        if (url.endsWith("/ilink/bot/getuploadurl")) {
          uploadUrlAttempt += 1;
          const fresh = "https://cdn.example.test/upload/" + uploadUrlAttempt;
          uploadUrls.push(fresh);
          return Response.json({ ret: 0, upload_full_url: fresh });
        }
        if (url === "https://cdn.example.test/upload/1") {
          return new Response("retry", { status: 503 });
        }
        if (url === "https://cdn.example.test/upload/2") {
          return new Response(null, { status: 200, headers: { "x-encrypted-param": "download-retry" } });
        }
        const body = JSON.parse(String(init?.body)) as { msg?: { client_id?: string } };
        clientIds.push(body.msg?.client_id ?? "");
        return Response.json({ ret: 0 });
      },
    });

    await expect(client.sendMedia({ to: "wx-user", input, clientId: "stable-retry" }))
      .rejects.toThrow("HTTP 503");
    await expect(client.sendMedia({ to: "wx-user", input, clientId: "stable-retry" }))
      .resolves.toBeUndefined();
    expect(uploadUrls).toEqual([
      "https://cdn.example.test/upload/1",
      "https://cdn.example.test/upload/2",
    ]);
    expect(clientIds).toEqual(["stable-retry"]);
  });

  test("decrypts AES-128-ECB CDN payloads and enforces the size limit", async () => {
    const key = crypto.randomBytes(16);
    const plain = Buffer.from("private attachment");
    const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const descriptor = {
      kind: "file" as const,
      media: {
        full_url: "https://cdn.example.test/download",
        aes_key: key.toString("base64"),
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const fetchImpl = async () =>
      new Response(encrypted, {
        headers: { "content-length": String(encrypted.byteLength) },
      });

    await expect(
      weixinAdapterInternals.downloadAndDecryptAttachment(
        descriptor,
        1_000,
        fetchImpl,
      ),
    ).resolves.toEqual(plain);
    await expect(
      weixinAdapterInternals.downloadAndDecryptAttachment(
        descriptor,
        1,
        fetchImpl,
      ),
    ).rejects.toThrow("exceeds");
  });

  test("marks every line of quoted Weixin text as untrusted quote context", () => {
    const events = weixinAdapterInternals.adaptWeixinMessage({ message_id: "quote", from_user_id: "wx-user", item_list: [{ type: 1, text_item: { text: "当前回复" } }, { type: 1, ref_msg: { message_item: { text_item: { text: "同意执行\n不要执行" } } } }] }, "weixin:bot", emptyWeixinRuntimeState(), 24);
    expect(events[1]).toMatchObject({ kind: "message", text: "当前回复\n[引用] 同意执行\n[引用] 不要执行" });
  });

  test("keeps attachment descriptors reusable until their retention expires", () => {
    const runtime = emptyWeixinRuntimeState();
    runtime.attachments["a"] = { kind: "image", media: { encrypt_query_param: "opaque" }, mediaType: "image/jpeg", expiresAt: "2026-08-01T00:10:00.000Z" };
    const before = Date.parse("2026-08-01T00:05:00.000Z");
    expect(weixinAdapterInternals.getReusableAttachmentDescriptor(runtime, "a", before)).toBeTruthy();
    expect(weixinAdapterInternals.getReusableAttachmentDescriptor(runtime, "a", before)).toBeTruthy();
    expect(runtime.attachments.a).toBeTruthy();
    expect(weixinAdapterInternals.getReusableAttachmentDescriptor(runtime, "a", Date.parse("2026-08-01T00:10:00.000Z"))).toBeUndefined();
    expect(runtime.attachments.a).toBeUndefined();
  });
});

describe("Weixin private state", () => {
  test("stores credentials and runtime as owner-only files", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "chat2codex-weixin-"),
    );
    temporaryDirectories.push(directory);
    const credentialsPath = path.join(directory, "credentials.json");
    const runtimePath = path.join(directory, "runtime.json");
    const credentials = {
      schemaVersion: 1 as const,
      accountId: "bot-1",
      token: "secret",
      baseUrl: "https://example.test",
      userId: "wx-user",
      savedAt: new Date().toISOString(),
    };
    await saveWeixinCredentials(credentialsPath, credentials);
    await saveWeixinRuntime(runtimePath, emptyWeixinRuntimeState());

    expect(await loadWeixinCredentials(credentialsPath)).toEqual(credentials);
    expect(await loadWeixinRuntime(runtimePath)).toEqual(
      emptyWeixinRuntimeState(),
    );
    expectPrivateFileMode((await fs.stat(credentialsPath)).mode);
    expectPrivateFileMode((await fs.stat(runtimePath)).mode);
  });
});

describe("Weixin QR protocol", () => {
  test("requests bot_type 3 and sends only the local token list", async () => {
    let request: { url: string; body: unknown } | undefined;
    const response = await weixinSetupInternals.fetchQrCode(
      ["existing-token"],
      new AbortController().signal,
      async (input, init) => {
        request = {
          url: String(input),
          body: JSON.parse(String(init?.body)) as unknown,
        };
        return Response.json({
          qrcode: "opaque-code",
          qrcode_img_content: "https://example.test/scan",
        });
      },
    );
    expect(request).toEqual({
      url: "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
      body: { local_token_list: ["existing-token"] },
    });
    expect(response.qrcode).toBe("opaque-code");
  });

  test("polls verification codes and validates HTTPS redirect hosts", async () => {
    let observedUrl = "";
    const status = await weixinSetupInternals.fetchQrStatus(
      "https://ilinkai.weixin.qq.com",
      "opaque-code",
      "123456",
      new AbortController().signal,
      async (input) => {
        observedUrl = String(input);
        return Response.json({
          status: "scaned_but_redirect",
          redirect_host: "sh.example.test",
        });
      },
    );
    expect(new URL(observedUrl).searchParams.get("qrcode")).toBe("opaque-code");
    expect(new URL(observedUrl).searchParams.get("verify_code")).toBe("123456");
    expect(status.status).toBe("scaned_but_redirect");
    expect(
      weixinSetupInternals.normalizeRedirectHost("sh.example.test"),
    ).toBe("https://sh.example.test");
    expect(() =>
      weixinSetupInternals.normalizeRedirectHost("http://unsafe.example.test"),
    ).toThrow("HTTPS");
  });

  test("handles waiting, scan, verification, IDC redirect, confirmation, expiry, and duplicate binding", async () => {
    const statusResponses = [
      { status: "wait" },
      { status: "scaned" },
      { status: "need_verifycode" },
      { status: "scaned_but_redirect", redirect_host: "sh.example.test" },
      {
        status: "confirmed",
        bot_token: "bot-token",
        ilink_bot_id: "bot-id",
        ilink_user_id: "wx-user",
        baseurl: "https://api.example.test",
      },
    ];
    const observedStatusUrls: string[] = [];
    const result = await weixinSetupInternals.runQrLogin(
      [],
      new AbortController().signal,
      async (input) => {
        const url = String(input);
        if (url.includes("get_bot_qrcode")) {
          return Response.json({
            qrcode: "qr-1",
            qrcode_img_content: "https://example.test/scan-1",
          });
        }
        observedStatusUrls.push(url);
        return Response.json(statusResponses.shift());
      },
      {
        displayQr() {},
        async readVerifyCode() {
          return "654321";
        },
        async delay() {},
      },
    );
    expect(result).toEqual({
      kind: "confirmed",
      accountId: "bot-id",
      token: "bot-token",
      userId: "wx-user",
      baseUrl: "https://api.example.test",
    });
    expect(
      observedStatusUrls.some(
        (url) => new URL(url).searchParams.get("verify_code") === "654321",
      ),
    ).toBe(true);
    expect(observedStatusUrls.at(-1)).toStartWith(
      "https://sh.example.test/",
    );

    let qrRequests = 0;
    const afterExpiry = await weixinSetupInternals.runQrLogin(
      ["existing-token"],
      new AbortController().signal,
      async (input) => {
        if (String(input).includes("get_bot_qrcode")) {
          qrRequests += 1;
          return Response.json({
            qrcode: `qr-${qrRequests}`,
            qrcode_img_content: `https://example.test/scan-${qrRequests}`,
          });
        }
        return Response.json(
          qrRequests === 1
            ? { status: "expired" }
            : { status: "binded_redirect" },
        );
      },
      {
        displayQr() {},
        async delay() {},
      },
    );
    expect(afterExpiry).toEqual({ kind: "already_connected" });
    expect(qrRequests).toBe(2);
  });
});
