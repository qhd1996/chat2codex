import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CodexSandboxPolicy } from "../agent/codex-runner.js";
import type { IsolationMode } from "../state/types.js";

const taskIdPattern = /^tsk_[a-f0-9]{24}$/u;
const probeTimeoutMs = 90_000;
const maxProbeReasonCharacters = 1_000;

export type ExecutionIntent = "general" | "output_only";

export interface ExecutionWorkspaceRequest {
  taskId: string;
  workspaceRoot: string;
  intent: ExecutionIntent;
}

export interface ExecutionWorkspace {
  taskId: string;
  workspaceRoot: string;
  sourceReadRoot: string;
  executionCwd: string;
  isolationMode: IsolationMode;
  sandboxPolicy?: CodexSandboxPolicy;
  fallbackReason?: string;
}

export interface OutputOnlySandboxProbeResult {
  verified: boolean;
  codexVersion?: string;
  reason?: string;
}

export interface ExecutionWorkspaceServiceOptions {
  chat2codexHome: string;
  codexBin: string;
  sandboxProbe?: (codexBin: string) => Promise<OutputOnlySandboxProbeResult>;
}

export class ExecutionWorkspaceService {
  readonly sandboxVerified: boolean;
  readonly sandboxCodexVersion?: string;

  private constructor(
    private readonly home: string,
    private readonly probeResult: OutputOnlySandboxProbeResult,
  ) {
    this.sandboxVerified = probeResult.verified && Boolean(probeResult.codexVersion?.trim());
    this.sandboxCodexVersion = probeResult.codexVersion;
  }

  static async create(options: ExecutionWorkspaceServiceOptions): Promise<ExecutionWorkspaceService> {
    const home = await ensureServiceHome(options.chat2codexHome);
    let probeResult: OutputOnlySandboxProbeResult;
    try {
      probeResult = await (options.sandboxProbe ?? probeInstalledCodexOutputOnlySandbox)(options.codexBin);
    } catch (error) {
      probeResult = {
        verified: false,
        reason: boundedReason("Codex output-only sandbox probe failed: " + errorMessage(error)),
      };
    }
    if (probeResult.verified && !probeResult.codexVersion?.trim()) {
      probeResult = { verified: false, reason: "Codex output-only sandbox probe omitted the Codex version." };
    } else if (!probeResult.verified && !probeResult.reason) {
      probeResult = { ...probeResult, reason: "Codex output-only sandbox probe did not verify isolation." };
    }
    return new ExecutionWorkspaceService(home, probeResult);
  }

  async prepare(request: ExecutionWorkspaceRequest): Promise<ExecutionWorkspace> {
    assertTaskId(request.taskId);
    const workspaceRoot = await canonicalWorkspaceRoot(request.workspaceRoot);
    const gitRoot = await findGitRoot(workspaceRoot);
    if (gitRoot) return this.prepareGitWorktree(request.taskId, workspaceRoot, gitRoot);

    if (request.intent === "output_only" && this.sandboxVerified) {
      const executionCwd = await ensureOutputDirectory(workspaceRoot, request.taskId);
      return {
        taskId: request.taskId,
        workspaceRoot,
        sourceReadRoot: workspaceRoot,
        executionCwd,
        isolationMode: "output_only",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [executionCwd],
          networkAccess: false,
          excludeTmpdirEnvVar: true,
          excludeSlashTmp: true,
        },
      };
    }

    return {
      taskId: request.taskId,
      workspaceRoot,
      sourceReadRoot: workspaceRoot,
      executionCwd: workspaceRoot,
      isolationMode: "canonical_fifo",
      ...(request.intent === "output_only"
        ? { fallbackReason: this.probeResult.reason ?? "Codex output-only sandbox isolation is unverified." }
        : {}),
    };
  }

  private async prepareGitWorktree(
    taskId: string,
    workspaceRoot: string,
    gitRoot: string,
  ): Promise<ExecutionWorkspace> {
    if (!samePath(gitRoot, workspaceRoot)) {
      throw new Error("Git workspace root must be the repository root before creating a task worktree.");
    }
    const worktreesRoot = await ensureChildDirectory(this.home, "worktrees");
    const destination = path.join(worktreesRoot, taskId);
    const branch = `chat2codex/${taskId}`;
    const existing = await fs.lstat(destination).catch(missingOnly);

    if (existing) {
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new Error("Task worktree destination is not a safe directory: " + destination);
      }
      const canonicalDestination = await fs.realpath(destination);
      if (!inside(worktreesRoot, canonicalDestination)) {
        throw new Error("Task worktree destination escapes the worktree root.");
      }
      await verifyReusableWorktree(canonicalDestination, gitRoot, branch);
      return workspaceResult(taskId, workspaceRoot, canonicalDestination);
    }

    try {
      await runFile("git", ["-C", gitRoot, "worktree", "add", "-b", branch, destination, "HEAD"]);
    } catch (error) {
      throw new Error("Git task worktree creation failed: " + errorMessage(error), { cause: error });
    }
    const canonicalDestination = await fs.realpath(destination);
    if (!inside(worktreesRoot, canonicalDestination)) {
      throw new Error("Created Git worktree escapes the worktree root.");
    }
    await verifyReusableWorktree(canonicalDestination, gitRoot, branch);
    return workspaceResult(taskId, workspaceRoot, canonicalDestination);
  }
}

function workspaceResult(taskId: string, workspaceRoot: string, executionCwd: string): ExecutionWorkspace {
  return {
    taskId, workspaceRoot, sourceReadRoot: workspaceRoot, executionCwd, isolationMode: "git_worktree",
  };
}

async function ensureServiceHome(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  await fs.mkdir(resolved, { recursive: true });
  const info = await fs.lstat(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("CHAT2CODEX_HOME must be a non-symlink directory.");
  const canonical = await fs.realpath(resolved);
  if (!samePath(resolved, canonical)) throw new Error("CHAT2CODEX_HOME must not traverse symlinks.");
  return canonical;
}

async function canonicalWorkspaceRoot(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate)) throw new Error("Workspace root must be absolute.");
  const resolved = path.resolve(candidate);
  const info = await fs.lstat(resolved).catch(missingOnly);
  if (!info?.isDirectory()) throw new Error("Workspace root must be an existing directory: " + resolved);
  if (info.isSymbolicLink()) throw new Error("Workspace root must not be a symlink.");
  const canonical = await fs.realpath(resolved);
  if (!samePath(resolved, canonical)) throw new Error("Workspace root must not traverse symlinks.");
  return canonical;
}

async function findGitRoot(workspaceRoot: string): Promise<string | undefined> {
  try {
    const result = await runFile("git", ["-C", workspaceRoot, "rev-parse", "--show-toplevel"]);
    const root = result.stdout.trim();
    if (!root || !path.isAbsolute(root)) throw new Error("Git returned an invalid repository root.");
    return fs.realpath(root);
  } catch (error) {
    if (isCommandNotFound(error)) throw new Error("Git is unavailable; execution workspace isolation cannot be classified.", { cause: error });
    if (/not a git repository/iu.test(errorMessage(error))) return undefined;
    throw new Error("Git workspace classification failed: " + errorMessage(error), { cause: error });
  }
}

async function verifyReusableWorktree(destination: string, gitRoot: string, branch: string): Promise<void> {
  try {
    const [topLevel, currentBranch, commonDirectory, sourceCommonDirectory] = await Promise.all([
      runFile("git", ["-C", destination, "rev-parse", "--show-toplevel"]),
      runFile("git", ["-C", destination, "branch", "--show-current"]),
      runFile("git", ["-C", destination, "rev-parse", "--git-common-dir"]),
      runFile("git", ["-C", gitRoot, "rev-parse", "--git-common-dir"]),
    ]);
    const canonicalTop = await fs.realpath(topLevel.stdout.trim());
    const commonPath = path.resolve(destination, commonDirectory.stdout.trim());
    const canonicalCommon = await fs.realpath(commonPath);
    const sourceCommonPath = path.resolve(gitRoot, sourceCommonDirectory.stdout.trim());
    const sourceCommon = await fs.realpath(sourceCommonPath);
    if (!samePath(canonicalTop, destination) || currentBranch.stdout.trim() !== branch || !samePath(canonicalCommon, sourceCommon)) {
      throw new Error("destination ownership or branch does not match this task");
    }
  } catch (error) {
    throw new Error("Existing task worktree destination is not reusable: " + errorMessage(error), { cause: error });
  }
}

async function ensureOutputDirectory(workspaceRoot: string, taskId: string): Promise<string> {
  let parent = workspaceRoot;
  for (const component of ["outputs", "tasks", taskId]) parent = await ensureChildDirectory(parent, component);
  return parent;
}

async function ensureChildDirectory(parent: string, component: string): Promise<string> {
  const destination = path.join(parent, component);
  const before = await fs.lstat(destination).catch(missingOnly);
  if (!before) {
    try {
      await fs.mkdir(destination);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  const info = await fs.lstat(destination);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Execution workspace directory must be a non-symlink directory: " + destination);
  }
  const canonical = await fs.realpath(destination);
  if (!inside(parent, canonical)) throw new Error("Execution workspace directory escapes its parent.");
  return canonical;
}

function assertTaskId(taskId: string): void {
  if (!taskIdPattern.test(taskId)) throw new Error("Invalid task ID for execution workspace.");
}

export async function probeInstalledCodexOutputOnlySandbox(codexBin: string): Promise<OutputOnlySandboxProbeResult> {
  let codexVersion: string | undefined;
  try {
    codexVersion = (await runFile(codexBin, ["--version"], 10_000)).stdout.trim();
    if (!codexVersion) return { verified: false, reason: "Codex version command returned no version." };
  } catch (error) {
    return { verified: false, reason: boundedReason("Codex version probe failed: " + errorMessage(error)) };
  }

  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chat2codex-codex-sandbox-"));
  try {
    const source = path.join(fixtureRoot, "source");
    const output = path.join(fixtureRoot, "output");
    await fs.mkdir(source);
    await fs.mkdir(output);
    const nonce = randomBytes(24).toString("hex");
    const secretFile = path.join(source, "named-source.txt");
    const sentinelFile = path.join(source, "sentinel.txt");
    const readProof = path.join(output, "read-proof.txt");
    const writeProof = path.join(output, "write-proof.txt");
    const attemptProof = path.join(output, "source-write-attempt.txt");
    const script = path.join(output, "probe.cjs");
    await fs.writeFile(secretFile, nonce);
    await fs.writeFile(sentinelFile, "UNCHANGED");
    await fs.writeFile(script, sandboxProbeScript({ secretFile, sentinelFile, readProof, writeProof, attemptProof }));

    const prompt = [
      "This is an automated sandbox contract probe.",
      `Run this exact command once: node ${JSON.stringify(script)}`,
      "Do not edit the script or any files yourself. Return after the command finishes, even if it reports a denied write.",
    ].join("\n");
    try {
      await runFile(codexBin, [
        "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules",
        "--skip-git-repo-check", "--sandbox", "workspace-write", "--cd", output, prompt,
      ], probeTimeoutMs);
    } catch (error) {
      return { verified: false, codexVersion, reason: boundedReason("Installed Codex sandbox probe turn failed: " + errorMessage(error)) };
    }

    const [readValue, writeValue, attemptValue, sentinelValue] = await Promise.all([
      fs.readFile(readProof, "utf8").catch(() => ""),
      fs.readFile(writeProof, "utf8").catch(() => ""),
      fs.readFile(attemptProof, "utf8").catch(() => ""),
      fs.readFile(sentinelFile, "utf8").catch(() => "MISSING"),
    ]);
    if (readValue !== nonce) return { verified: false, codexVersion, reason: "Codex sandbox could not read the named absolute source file." };
    if (writeValue !== "OUTPUT_WRITE_OK") return { verified: false, codexVersion, reason: "Codex sandbox could not write inside the task output directory." };
    if (!attemptValue.startsWith("DENIED:")) return { verified: false, codexVersion, reason: "Codex sandbox did not prove a denied source write." };
    if (sentinelValue !== "UNCHANGED") return { verified: false, codexVersion, reason: "Codex sandbox modified the source workspace sentinel." };
    return { verified: true, codexVersion };
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

function sandboxProbeScript(paths: { secretFile: string; sentinelFile: string; readProof: string; writeProof: string; attemptProof: string }): string {
  return [
    '"use strict";',
    'const fs = require("node:fs");',
    `const p = ${JSON.stringify(paths)};`,
    'const value = fs.readFileSync(p.secretFile, "utf8");',
    'fs.writeFileSync(p.readProof, value);',
    'fs.writeFileSync(p.writeProof, "OUTPUT_WRITE_OK");',
    'try {',
    '  fs.writeFileSync(p.sentinelFile, "MUTATED");',
    '  fs.writeFileSync(p.attemptProof, "ALLOWED");',
    '} catch (error) {',
    '  fs.writeFileSync(p.attemptProof, "DENIED:" + String(error && error.code || "UNKNOWN"));',
    '}',
    '',
  ].join("\n");
}

interface FileResult { stdout: string; stderr: string; }

function runFile(command: string, args: string[], timeout = 30_000): Promise<FileResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next) > 2 * 1024 * 1024) { overflow = true; child.kill(); }
      return next;
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => child.kill(), timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (overflow) { reject(new Error("Command output exceeded the 2 MiB limit.")); return; }
      if (code !== 0) {
        const detail = (stderr || stdout).trim();
        reject(new Error(detail || `Command exited with code ${String(code)}${signal ? ` (${signal})` : ""}.`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function missingOnly(error: unknown): null {
  if (isCode(error, "ENOENT")) return null;
  throw error;
}

function isAlreadyExists(error: unknown): boolean { return isCode(error, "EEXIST"); }
function isCommandNotFound(error: unknown): boolean { return isCode(error, "ENOENT"); }
function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function boundedReason(value: string): string {
  const inline = value.replace(/[\r\n]+/gu, " ").replace(/\s+/gu, " ").trim();
  return inline.length <= maxProbeReasonCharacters ? inline : inline.slice(0, maxProbeReasonCharacters - 1) + "…";
}
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}
function samePath(left: string, right: string): boolean {
  return platformKey(path.resolve(left)) === platformKey(path.resolve(right));
}
function platformKey(value: string): string { return process.platform === "win32" ? value.toLocaleLowerCase() : value; }
