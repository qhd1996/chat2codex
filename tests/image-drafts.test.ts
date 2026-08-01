import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ImageDraftService } from "../src/core/image-drafts.js";
import type { ImageDraft } from "../src/state/types.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture(overrides: Partial<ConstructorParameters<typeof ImageDraftService>[0]> = {}) {
  const container = await fs.mkdtemp(path.join(os.tmpdir(), "chat2codex-drafts-")); roots.push(container);
  const root = path.join(container, "attachments"); await fs.mkdir(root);
  let now = Date.UTC(2026, 7, 1);
  const service = new ImageDraftService({ root, ttlMs: 60_000, maxCount: 4, maxFileBytes: 100, maxTotalBytes: 250, now: () => now, ...overrides });
  return { container, root, service, advance: (ms: number) => { now += ms; } };
}

async function image(root: string, name: string, kind: "jpeg" | "png" = "jpeg") {
  const file = path.join(root, name);
  const bytes = kind === "jpeg" ? Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]) : Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]);
  await fs.writeFile(file, bytes); return file;
}

describe("ImageDraftService", () => {
  test("stages and appends up to four validated images for one sender", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {};
    for (let i = 1; i <= 4; i++) await f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: `m${i}`, path: await image(f.root, `${i}.jpg`), mediaType: "image/jpeg" });
    expect(drafts["c:u"]?.images).toHaveLength(4);
    await expect(f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m5", path: await image(f.root, "5.jpg"), mediaType: "image/jpeg" })).rejects.toThrow(/4/);
  });

  test("keeps senders isolated and submits one sender draft", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {};
    await f.service.stage(drafts, { chatId: "c", senderKey: "u1", sourceMessageId: "m1", path: await image(f.root, "a.jpg"), mediaType: "image/jpeg" });
    await f.service.stage(drafts, { chatId: "c", senderKey: "u2", sourceMessageId: "m2", path: await image(f.root, "b.jpg"), mediaType: "image/jpeg" });
    const submitted = f.service.take(drafts, "c", "u1");
    expect(submitted?.images).toHaveLength(1); expect(drafts["c:u1"]).toBeUndefined(); expect(drafts["c:u2"]).toBeTruthy();
  });

  test("peek is non-consuming and consume removes exactly one sender draft", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {};
    await f.service.stage(drafts, { chatId: "c", senderKey: "u1", sourceMessageId: "m1", path: await image(f.root, "peek.jpg"), mediaType: "image/jpeg" });
    await f.service.stage(drafts, { chatId: "c", senderKey: "u2", sourceMessageId: "m2", path: await image(f.root, "other.jpg"), mediaType: "image/jpeg" });

    const first = f.service.peek(drafts, "c", "u1");
    const second = f.service.peek(drafts, "c", "u1");

    expect(first).toBe(second);
    expect(drafts["c:u1"]).toBe(first);
    expect(f.service.consume(drafts, "c", "u1")).toBe(first);
    expect(drafts["c:u1"]).toBeUndefined();
    expect(drafts["c:u2"]).toBeTruthy();
  });

  test("discard consumes the draft and securely deletes its files", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {};
    const file = await image(f.root, "discard.jpg");
    await f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m", path: file, mediaType: "image/jpeg" });

    expect(await f.service.discard(drafts, "c", "u")).toBe(true);

    expect(drafts["c:u"]).toBeUndefined();
    expect(await fs.stat(file).catch(() => null)).toBeNull();
  });

  test("deletes a fifth image while preserving the first four", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {}; const firstFour: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const file = await image(f.root, `kept-${i}.jpg`); firstFour.push(file);
      await f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: `m${i}`, path: file, mediaType: "image/jpeg" });
    }
    const fifth = await image(f.root, "rejected.jpg");

    await expect(f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m5", path: fifth, mediaType: "image/jpeg" })).rejects.toThrow(/4/);

    expect(drafts["c:u"]?.images.map((item) => path.normalize(item.path).toLocaleLowerCase())).toEqual(firstFour.map((item) => path.normalize(item).toLocaleLowerCase()));
    expect(await Promise.all(firstFour.map((file) => fs.stat(file).then(() => true)))).toEqual([true, true, true, true]);
    expect(await fs.stat(fifth).catch(() => null)).toBeNull();
  });

  test("rejects non-images, outside files, and byte limits", async () => {
    const f = await fixture({ maxFileBytes: 8, maxTotalBytes: 12 }); const drafts: Record<string, ImageDraft> = {};
    const text = path.join(f.root, "bad.jpg"); await fs.writeFile(text, "bad");
    await expect(f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m", path: text, mediaType: "image/jpeg" })).rejects.toThrow(/signature/i);
    const outside = await image(f.container, "outside.jpg");
    await expect(f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m", path: outside, mediaType: "image/jpeg" })).rejects.toThrow(/outside/i);
    const big = path.join(f.root, "big.png"); await fs.writeFile(big, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(5)]));
    await expect(f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m", path: big, mediaType: "image/png" })).rejects.toThrow(/per-file/i);
  });

  test("cancels and expires drafts while deleting only staged files", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {};
    const first = await image(f.root, "a.jpg"); await f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m", path: first, mediaType: "image/jpeg" });
    await f.service.cancel(drafts, "c", "u"); expect(await fs.stat(first).catch(() => null)).toBeNull();
    const second = await image(f.root, "b.jpg"); await f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m2", path: second, mediaType: "image/jpeg" });
    f.advance(60_001); expect(await f.service.expire(drafts)).toEqual(["c:u"]); expect(await fs.stat(second).catch(() => null)).toBeNull();
  });

  test("revalidates restart metadata and drops changed files", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {};
    const file = await image(f.root, "a.jpg"); await f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m", path: file, mediaType: "image/jpeg" });
    expect(await f.service.revalidate(drafts)).toEqual([]);
    await fs.appendFile(file, "changed");
    expect(await f.service.revalidate(drafts)).toEqual(["c:u"]); expect(drafts["c:u"]).toBeUndefined();
  });

  test("drops restart metadata whose recorded total does not match the files", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {};
    const file = await image(f.root, "total.jpg"); await f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "m", path: file, mediaType: "image/jpeg" });
    drafts["c:u"]!.totalBytes = 0;
    expect(await f.service.revalidate(drafts)).toEqual(["c:u"]); expect(drafts["c:u"]).toBeUndefined();
  });

  test("does not delete the persisted image when the same source is staged again", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {}; const file = await image(f.root, "same.jpg");
    const input = { chatId: "c", senderKey: "u", sourceMessageId: "same", path: file, mediaType: "image/jpeg" };
    await f.service.stage(drafts, input); await f.service.stage(drafts, input);
    expect(drafts["c:u"]?.images).toHaveLength(1); expect(await fs.stat(file)).toBeTruthy();
  });

  test("detects the actual supported image signature when Weixin reports JPEG generically", async () => {
    const f = await fixture(); const drafts: Record<string, ImageDraft> = {}; const file = await image(f.root, "screen.jpg", "png");
    await f.service.stage(drafts, { chatId: "c", senderKey: "u", sourceMessageId: "png", path: file, mediaType: "image/jpeg" });
    expect(drafts["c:u"]?.images[0]?.mediaType).toBe("image/png");
  });
});
