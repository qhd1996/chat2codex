import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ImageDraft } from "../state/types.js";

export interface ImageDraftServiceOptions {
  root: string; ttlMs: number; maxCount: number; maxFileBytes: number; maxTotalBytes: number; now?: () => number;
}

export interface StageImageInput {
  chatId: string; senderKey: string; sourceMessageId: string; path: string; mediaType: string;
}

export class ImageDraftService {
  private readonly now: () => number;
  constructor(private readonly options: ImageDraftServiceOptions) { this.now = options.now ?? Date.now; }

  key(chatId: string, senderKey: string): string { return `${chatId}:${senderKey}`; }

  async stage(drafts: Record<string, ImageDraft>, input: StageImageInput): Promise<ImageDraft> {
    try {
      const file = await this.validateFile(input.path, input.mediaType);
      const key = this.key(input.chatId, input.senderKey);
      const current = drafts[key];
      const existing = current?.images.find((image) => image.sourceMessageId === input.sourceMessageId);
      if (existing) { if (path.resolve(file.path) !== path.resolve(existing.path)) await this.safeDeleteCandidate(file.path); return current!; }
      if ((current?.images.length ?? 0) >= this.options.maxCount) throw new Error(`Image draft limit is ${this.options.maxCount}.`);
      if ((current?.totalBytes ?? 0) + file.bytes > this.options.maxTotalBytes) throw new Error("Image draft exceeds the total-byte limit.");
      const now = new Date(this.now()).toISOString();
      const draft: ImageDraft = current ?? { chatId: input.chatId, senderKey: input.senderKey, createdAt: now, updatedAt: now, expiresAt: now, images: [], totalBytes: 0 };
      draft.images.push({ sourceMessageId: input.sourceMessageId, path: file.path, sha256: file.sha256, mediaType: file.mediaType, bytes: file.bytes });
      draft.totalBytes += file.bytes; draft.updatedAt = now; draft.expiresAt = new Date(this.now() + this.options.ttlMs).toISOString(); drafts[key] = draft; return draft;
    } catch (error) {
      await this.safeDeleteCandidate(input.path);
      throw error;
    }
  }

  peek(drafts: Record<string, ImageDraft>, chatId: string, senderKey: string): ImageDraft | undefined {
    return drafts[this.key(chatId, senderKey)];
  }

  consume(drafts: Record<string, ImageDraft>, chatId: string, senderKey: string): ImageDraft | undefined {
    const key = this.key(chatId, senderKey); const draft = drafts[key]; if (draft) delete drafts[key]; return draft;
  }

  /** @deprecated Use consume for explicit disposition semantics. */
  take(drafts: Record<string, ImageDraft>, chatId: string, senderKey: string): ImageDraft | undefined {
    return this.consume(drafts, chatId, senderKey);
  }

  async discard(drafts: Record<string, ImageDraft>, chatId: string, senderKey: string): Promise<boolean> {
    const draft = this.consume(drafts, chatId, senderKey); if (!draft) return false; await this.deleteDraftFiles(draft); return true;
  }

  async cancel(drafts: Record<string, ImageDraft>, chatId: string, senderKey: string): Promise<boolean> {
    return this.discard(drafts, chatId, senderKey);
  }

  takeExpired(drafts: Record<string, ImageDraft>): Array<{ key: string; draft: ImageDraft }> {
    const expired: Array<{ key: string; draft: ImageDraft }> = []; const now = this.now();
    for (const [key, draft] of Object.entries(drafts)) if (Date.parse(draft.expiresAt) <= now) { delete drafts[key]; expired.push({ key, draft }); }
    return expired;
  }

  async deleteFiles(draft: ImageDraft): Promise<void> { await this.deleteDraftFiles(draft); }

  async expire(drafts: Record<string, ImageDraft>): Promise<string[]> {
    const expired = this.takeExpired(drafts);
    for (const item of expired) await this.deleteDraftFiles(item.draft);
    return expired.map((item) => item.key);
  }

  async revalidate(drafts: Record<string, ImageDraft>): Promise<string[]> {
    const invalid: string[] = [];
    for (const [key, draft] of Object.entries(drafts)) {
      let valid = draft.images.length > 0 && draft.images.length <= this.options.maxCount && draft.totalBytes <= this.options.maxTotalBytes;
      let actualTotal = 0;
      for (const image of draft.images) {
        try { const checked = await this.validateFile(image.path, image.mediaType); actualTotal += checked.bytes; valid &&= checked.sha256 === image.sha256 && checked.bytes === image.bytes; } catch { valid = false; }
      }
      valid &&= actualTotal === draft.totalBytes;
      if (!valid) { delete drafts[key]; invalid.push(key); }
    }
    return invalid;
  }

  private async validateFile(filePath: string, mediaType: string) {
    const root = await fs.realpath(this.options.root); const real = await fs.realpath(filePath); assertInside(root, real);
    const stat = await fs.lstat(real); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Image path is not a regular file.");
    if (stat.size > this.options.maxFileBytes) throw new Error("Image exceeds the per-file limit.");
    const bytes = await fs.readFile(real); const detected = detectImageMediaType(bytes);
    if (!detected || !mediaType.toLowerCase().startsWith("image/")) throw new Error("Image signature does not match a supported image type.");
    return { path: real, bytes: stat.size, mediaType: detected, sha256: createHash("sha256").update(bytes).digest("hex") };
  }

  private async deleteDraftFiles(draft: ImageDraft): Promise<void> {
    const root = await fs.realpath(this.options.root);
    for (const image of draft.images) { try { const real = await fs.realpath(image.path); assertInside(root, real); await fs.rm(real, { force: true }); } catch { /* invalid/missing files are not followed */ } }
  }

  private async safeDeleteCandidate(filePath: string): Promise<void> {
    try { const root = await fs.realpath(this.options.root); const real = await fs.realpath(filePath); assertInside(root, real); await fs.rm(real, { force: true }); } catch { /* never delete unvalidated paths */ }
  }
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate); if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Image path is outside the attachment root.");
}

function detectImageMediaType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
