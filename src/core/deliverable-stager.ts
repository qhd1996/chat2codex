import { createHash } from "node:crypto";
import { constants as fsConstants, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { IsolationMode } from "../state/types.js";

const taskIdPattern = /^tsk_[a-f0-9]{24}$/u;
const maximumDeliverables = 16;

export interface StagedDeliverable {
  sourcePath: string;
  stagedPath: string;
  fileName: string;
  kind: "image" | "file";
  mediaType: string;
  size: number;
  sha256: string;
}

export interface DeliverableStagerOptions {
  chat2codexHome: string;
  maxCount?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface StageDeliverablesInput {
  taskId: string;
  jobId: string;
  workspaceRoot: string;
  executionCwd: string;
  isolationMode: IsolationMode;
  paths: string[];
}

export interface CleanupDeliverablesInput {
  taskId: string;
  jobId: string;
}

interface SourceFile {
  sourcePath: string;
  fileName: string;
  size: number;
  identity: FileIdentity;
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

export class DeliverableStager {
  private readonly home: string;
  private readonly maxCount: number;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;

  constructor(options: DeliverableStagerOptions) {
    this.home = path.resolve(options.chat2codexHome);
    this.maxCount = positiveLimit(options.maxCount ?? maximumDeliverables, "deliverable count", maximumDeliverables);
    this.maxFileBytes = positiveLimit(options.maxFileBytes ?? 25 * 1024 ** 2, "per-file byte");
    this.maxTotalBytes = positiveLimit(options.maxTotalBytes ?? 50 * 1024 ** 2, "per-turn byte");
    if (this.maxFileBytes > this.maxTotalBytes) {
      throw new Error("Outbound media per-file limit must not exceed the per-turn limit.");
    }
  }

  async stage(input: StageDeliverablesInput): Promise<StagedDeliverable[]> {
    assertIdentifiers(input.taskId, input.jobId);
    if (!Array.isArray(input.paths)) throw new Error("Declared output files must be an array.");
    if (input.paths.length > this.maxCount) {
      throw new Error(`Declared output file count exceeds the configured ${this.maxCount}-file limit.`);
    }
    if (input.paths.length === 0) return [];

    const home = await canonicalDirectory(this.home, "CHAT2CODEX_HOME");
    const workspaceRoot = await canonicalDirectory(input.workspaceRoot, "Task workspace root");
    const authorizedRoots = [workspaceRoot];
    if (input.isolationMode === "output_only") {
      const executionCwd = await canonicalDirectory(input.executionCwd, "Output-only private execution directory");
      const expectedExecutionCwd = path.join(workspaceRoot, "outputs", "tasks", input.taskId);
      if (!samePath(executionCwd, expectedExecutionCwd)) {
        throw new Error("Output-only deliverables require the task's exact private execution directory.");
      }
      authorizedRoots.push(executionCwd);
    }

    const sources: SourceFile[] = [];
    const seen = new Set<string>();
    let totalBytes = 0;
    for (const declaredPath of input.paths) {
      const source = await validateSource(declaredPath, authorizedRoots);
      const key = platformKey(source.sourcePath);
      if (seen.has(key)) throw new Error("Declared output files contain a duplicate canonical path.");
      seen.add(key);
      if (source.size > this.maxFileBytes) {
        throw new Error(`Declared output file exceeds the configured ${this.maxFileBytes}-byte per-file limit.`);
      }
      totalBytes += source.size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > this.maxTotalBytes) {
        throw new Error(`Declared output files exceed the configured ${this.maxTotalBytes}-byte per-turn limit.`);
      }
      sources.push(source);
    }

    const taskDirectory = await ensurePrivateChildDirectory(
      await ensurePrivateChildDirectory(home, "outbound"),
      input.taskId,
    );
    const jobComponent = safeIdentifierComponent(input.jobId);
    const jobDirectory = path.join(taskDirectory, jobComponent);
    try {
      await fs.mkdir(jobDirectory, { mode: 0o700 });
    } catch (error) {
      if (hasCode(error, "EEXIST")) {
        throw new Error("Outbound staging job destination already exists and may be dirty.", { cause: error });
      }
      throw error;
    }
    await fs.chmod(jobDirectory, 0o700);

    let ownsJobDirectory = true;
    try {
      const canonicalJobDirectory = await canonicalDirectory(jobDirectory, "Outbound staging job directory");
      if (!inside(taskDirectory, canonicalJobDirectory)) throw new Error("Outbound staging job directory escapes its task root.");
      const staged: StagedDeliverable[] = [];
      for (let index = 0; index < sources.length; index += 1) {
        staged.push(await snapshotSource(sources[index]!, canonicalJobDirectory, index));
      }
      ownsJobDirectory = false;
      return staged;
    } finally {
      if (ownsJobDirectory) await removeNewJobDirectory(jobDirectory, taskDirectory);
    }
  }

  async cleanup(input: CleanupDeliverablesInput): Promise<void> {
    assertIdentifiers(input.taskId, input.jobId);
    const home = await canonicalDirectory(this.home, "CHAT2CODEX_HOME");
    const outbound = await safeExistingDirectory(path.join(home, "outbound"));
    if (!outbound) return;
    const taskDirectory = await safeExistingDirectory(path.join(outbound, input.taskId));
    if (!taskDirectory) return;
    const jobPath = path.join(taskDirectory, safeIdentifierComponent(input.jobId));
    const info = await fs.lstat(jobPath).catch(missingOnly);
    if (!info) return;
    if (info.isSymbolicLink()) {
      await fs.unlink(jobPath);
      return;
    }
    if (!info.isDirectory()) throw new Error("Outbound staging cleanup target is not a directory.");
    const canonicalJob = await fs.realpath(jobPath);
    if (!inside(taskDirectory, canonicalJob)) throw new Error("Outbound staging cleanup target escapes its task root.");
    await fs.rm(jobPath, { recursive: true, force: false });
  }
}

async function validateSource(candidate: string, authorizedRoots: string[]): Promise<SourceFile> {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error("Declared output file path must be absolute.");
  }
  const resolved = path.resolve(candidate);
  const info = await fs.lstat(resolved, { bigint: true }).catch(missingOnly);
  if (!info) throw new Error("Declared output file does not exist.");
  if (info.isSymbolicLink()) throw new Error("Declared output file must not be a symlink.");
  if (!info.isFile()) throw new Error("Declared output path must be a regular file.");
  const canonical = await fs.realpath(resolved);
  if (!samePath(resolved, canonical)) {
    throw new Error("Declared output file path must be canonical and must not traverse symlinks.");
  }
  if (!authorizedRoots.some((root) => inside(root, canonical))) {
    throw new Error("Declared output file is outside the task's authorized root.");
  }
  return {
    sourcePath: canonical,
    fileName: safeFileName(path.basename(canonical)),
    size: Number(info.size),
    identity: identityOf(info),
  };
}

async function snapshotSource(source: SourceFile, jobDirectory: string, index: number): Promise<StagedDeliverable> {
  const stagedPath = path.join(jobDirectory, `${String(index + 1).padStart(2, "0")}-${source.fileName}`);
  const openFlags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(source.sourcePath, openFlags);
  const hash = createHash("sha256");
  let completed = false;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameIdentity(source.identity, identityOf(opened))) {
      throw new Error("Declared output source changed before staging began.");
    }
    const digesting = new Transform({
      transform(chunk: Buffer, _encoding, callback) { hash.update(chunk); callback(null, chunk); },
    });
    await pipeline(
      handle.createReadStream({ autoClose: false }),
      digesting,
      createWriteStream(stagedPath, { flags: "wx", mode: 0o600 }),
    );
    const [afterHandle, afterPath, currentCanonical] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(source.sourcePath, { bigint: true }),
      fs.realpath(source.sourcePath),
    ]);
    if (
      !afterPath.isFile() || afterPath.isSymbolicLink() ||
      !samePath(currentCanonical, source.sourcePath) ||
      !sameIdentity(source.identity, identityOf(afterHandle)) ||
      !sameIdentity(source.identity, identityOf(afterPath))
    ) {
      throw new Error("Declared output source changed while it was being staged.");
    }
    const stagedInfo = await fs.lstat(stagedPath);
    if (!stagedInfo.isFile() || stagedInfo.isSymbolicLink() || stagedInfo.size !== source.size) {
      throw new Error("Staged deliverable failed immutable snapshot validation.");
    }
    const sniffed = await sniffMedia(stagedPath);
    completed = true;
    return {
      sourcePath: source.sourcePath, stagedPath, fileName: source.fileName,
      kind: sniffed.kind, mediaType: sniffed.mediaType, size: source.size, sha256: hash.digest("hex"),
    };
  } finally {
    await handle.close().catch(() => undefined);
    if (!completed) await fs.rm(stagedPath, { force: true }).catch(() => undefined);
  }
}

async function sniffMedia(filePath: string): Promise<{ kind: "image" | "file"; mediaType: string }> {
  const handle = await fs.open(filePath, "r");
  try {
    const bytes = Buffer.alloc(16);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const header = bytes.subarray(0, bytesRead);
    const mediaType = imageMediaType(header);
    return mediaType
      ? { kind: "image", mediaType }
      : { kind: "file", mediaType: "application/octet-stream" };
  } finally {
    await handle.close();
  }
}

function imageMediaType(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) || bytes.subarray(0, 6).equals(Buffer.from("GIF89a")))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"))) return "image/webp";
  return undefined;
}

async function canonicalDirectory(candidate: string, label: string): Promise<string> {
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be absolute.`);
  const resolved = path.resolve(candidate);
  const info = await fs.lstat(resolved).catch(missingOnly);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be an existing non-symlink directory.`);
  const canonical = await fs.realpath(resolved);
  if (!samePath(resolved, canonical)) throw new Error(`${label} must be canonical and must not traverse symlinks.`);
  return canonical;
}

async function ensurePrivateChildDirectory(parent: string, component: string): Promise<string> {
  const destination = path.join(parent, component);
  try {
    await fs.mkdir(destination, { mode: 0o700 });
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  const info = await fs.lstat(destination);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Outbound staging path must be a non-symlink directory.");
  await fs.chmod(destination, 0o700);
  const canonical = await fs.realpath(destination);
  if (!inside(parent, canonical)) throw new Error("Outbound staging path escapes its parent.");
  return canonical;
}

async function safeExistingDirectory(candidate: string): Promise<string | undefined> {
  const info = await fs.lstat(candidate).catch(missingOnly);
  if (!info) return undefined;
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Outbound staging path must be a non-symlink directory.");
  const canonical = await fs.realpath(candidate);
  if (!samePath(candidate, canonical)) throw new Error("Outbound staging path must be canonical.");
  return canonical;
}

async function removeNewJobDirectory(jobDirectory: string, taskDirectory: string): Promise<void> {
  const info = await fs.lstat(jobDirectory).catch(missingOnly);
  if (!info) return;
  if (info.isSymbolicLink()) {
    await fs.unlink(jobDirectory);
    return;
  }
  if (!info.isDirectory()) {
    await fs.unlink(jobDirectory);
    return;
  }
  const canonical = await fs.realpath(jobDirectory);
  if (!inside(taskDirectory, canonical)) throw new Error("Refusing to clean a staging directory outside its task root.");
  await fs.rm(jobDirectory, { recursive: true, force: true });
}

function assertIdentifiers(taskId: string, jobId: string): void {
  if (!taskIdPattern.test(taskId)) throw new Error("Invalid task ID for outbound staging.");
  if (typeof jobId !== "string" || !jobId.trim() || jobId.length > 512) throw new Error("Invalid job ID for outbound staging.");
}

function safeIdentifierComponent(value: string): string {
  if (/^[A-Za-z0-9._-]{1,128}$/u.test(value) && value !== "." && value !== "..") return value;
  return `job-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function safeFileName(value: string): string {
  const base = path.basename(value).normalize("NFKC");
  let safe = base.replace(/[<>:"/\|?*\u0000-\u001f]/gu, "_").replace(/[. ]+$/gu, "").trim();
  if (!safe || safe === "." || safe === "..") safe = "deliverable.bin";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/iu.test(safe)) safe = "_" + safe;
  if (safe.length > 160) {
    const extension = path.extname(safe).slice(0, 20);
    safe = safe.slice(0, 160 - extension.length) + extension;
  }
  return safe;
}

function identityOf(info: { dev: bigint | number; ino: bigint | number; size: bigint | number; mtimeNs?: bigint; ctimeNs?: bigint; mtimeMs?: bigint | number; ctimeMs?: bigint | number }): FileIdentity {
  return {
    dev: BigInt(info.dev), ino: BigInt(info.ino), size: BigInt(info.size),
    mtimeNs: info.mtimeNs ?? millisecondsToNanoseconds(info.mtimeMs),
    ctimeNs: info.ctimeNs ?? millisecondsToNanoseconds(info.ctimeMs),
  };
}

function millisecondsToNanoseconds(value: bigint | number | undefined): bigint {
  return typeof value === "bigint"
    ? value * 1_000_000n
    : BigInt(Math.trunc((value ?? 0) * 1_000_000));
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function positiveLimit(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error(`Invalid ${label} limit.`);
  return value;
}
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}
function samePath(left: string, right: string): boolean { return platformKey(path.resolve(left)) === platformKey(path.resolve(right)); }
function platformKey(value: string): string { return process.platform === "win32" ? value.toLocaleLowerCase() : value; }
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
function missingOnly(error: unknown): undefined {
  if (hasCode(error, "ENOENT")) return undefined;
  throw error;
}
