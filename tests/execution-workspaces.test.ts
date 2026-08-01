import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  ExecutionWorkspaceService,
  probeInstalledCodexOutputOnlySandbox,
  type OutputOnlySandboxProbeResult,
} from "../src/core/execution-workspaces.js";
import { supportsFileSymlinks } from "./helpers/platform.js";

const execFileAsync = promisify(execFile);
const taskA = "tsk_aaaaaaaaaaaaaaaaaaaaaaaa";
const taskB = "tsk_bbbbbbbbbbbbbbbbbbbbbbbb";

function verifiedProbe(): Promise<OutputOnlySandboxProbeResult> {
  return Promise.resolve({ verified: true, codexVersion: "codex-test 1.0" });
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-execution-"));
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  await mkdir(home);
  await mkdir(workspace);
  return { root, home, workspace };
}

async function cleanup(directory: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error && "code" in error && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(String((error as NodeJS.ErrnoException).code)))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function initGitRepository(directory: string): Promise<void> {
  await execFileAsync("git", ["init", directory]);
  await execFileAsync("git", ["-C", directory, "config", "user.email", "tests@example.invalid"]);
  await execFileAsync("git", ["-C", directory, "config", "user.name", "Chat2Codex Tests"]);
  await writeFile(path.join(directory, "source.txt"), "source");
  await execFileAsync("git", ["-C", directory, "add", "source.txt"]);
  await execFileAsync("git", ["-C", directory, "commit", "-m", "fixture"]);
}

describe("ExecutionWorkspaceService", () => {
  test("creates and reuses a persistent task Git worktree", async () => {
    const f = await fixture();
    try {
      await initGitRepository(f.workspace);
      const service = await ExecutionWorkspaceService.create({
        chat2codexHome: f.home, codexBin: "codex", sandboxProbe: verifiedProbe,
      });

      const first = await service.prepare({ taskId: taskA, workspaceRoot: f.workspace, intent: "general" });
      expect(first.isolationMode).toBe("git_worktree");
      expect(first.executionCwd).toBe(await realpath(path.join(f.home, "worktrees", taskA)));
      expect(first.workspaceRoot).toBe(await realpath(f.workspace));
      expect(first.sourceReadRoot).toBe(await realpath(f.workspace));
      expect(first.sandboxPolicy).toBeUndefined();
      expect((await execFileAsync("git", ["-C", first.executionCwd, "branch", "--show-current"])).stdout.trim()).toBe(`chat2codex/${taskA}`);

      await writeFile(path.join(first.executionCwd, "turn-state.txt"), "kept");
      const second = await service.prepare({ taskId: taskA, workspaceRoot: f.workspace, intent: "general" });
      expect(second.executionCwd).toBe(first.executionCwd);
      expect(await readFile(path.join(second.executionCwd, "turn-state.txt"), "utf8")).toBe("kept");
    } finally {
      await cleanup(f.root);
    }
  });

  test("creates a task worktree when the configured source is itself a linked worktree", async () => {
    const f = await fixture();
    try {
      await initGitRepository(f.workspace);
      const linkedSource = path.join(f.root, "linked-source");
      await execFileAsync("git", ["-C", f.workspace, "worktree", "add", "-b", "linked-source", linkedSource, "HEAD"]);
      const service = await ExecutionWorkspaceService.create({
        chat2codexHome: f.home, codexBin: "codex", sandboxProbe: verifiedProbe,
      });

      const result = await service.prepare({ taskId: taskA, workspaceRoot: linkedSource, intent: "general" });

      expect(result).toMatchObject({
        isolationMode: "git_worktree",
        workspaceRoot: await realpath(linkedSource),
        sourceReadRoot: await realpath(linkedSource),
        executionCwd: await realpath(path.join(f.home, "worktrees", taskA)),
      });
      expect((await execFileAsync("git", ["-C", result.executionCwd, "branch", "--show-current"])).stdout.trim())
        .toBe(`chat2codex/${taskA}`);
    } finally {
      await cleanup(f.root);
    }
  });

  test("isolates verified non-Git output-only tasks to one private writable root", async () => {
    const f = await fixture();
    try {
      const service = await ExecutionWorkspaceService.create({
        chat2codexHome: f.home, codexBin: "codex", sandboxProbe: verifiedProbe,
      });
      expect(service.sandboxVerified).toBe(true);
      expect(service.sandboxCodexVersion).toBe("codex-test 1.0");

      const result = await service.prepare({ taskId: taskA, workspaceRoot: f.workspace, intent: "output_only" });
      const output = await realpath(path.join(f.workspace, "outputs", "tasks", taskA));
      expect(result).toMatchObject({
        isolationMode: "output_only", executionCwd: output, sourceReadRoot: await realpath(f.workspace),
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [output], networkAccess: false },
      });
      expect(result.sandboxPolicy?.type === "workspaceWrite" ? result.sandboxPolicy.writableRoots : []).not.toContain(await realpath(f.workspace));
    } finally {
      await cleanup(f.root);
    }
  });

  test("falls back to canonical FIFO for general or unverified non-Git work", async () => {
    const f = await fixture();
    try {
      const service = await ExecutionWorkspaceService.create({
        chat2codexHome: f.home,
        codexBin: "codex",
        sandboxProbe: async () => ({ verified: false, codexVersion: "codex-test 2.0", reason: "source sentinel was modified" }),
      });
      expect(service.sandboxVerified).toBe(false);
      const canonical = await realpath(f.workspace);
      expect(await service.prepare({ taskId: taskA, workspaceRoot: f.workspace, intent: "general" })).toMatchObject({
        isolationMode: "canonical_fifo", executionCwd: canonical,
      });
      expect(await service.prepare({ taskId: taskB, workspaceRoot: f.workspace, intent: "output_only" })).toMatchObject({
        isolationMode: "canonical_fifo", executionCwd: canonical, fallbackReason: expect.stringContaining("source sentinel"),
      });
    } finally {
      await cleanup(f.root);
    }
  });

  test("rejects invalid IDs, missing roots, symlink roots, dirty destinations, and Git failures", async () => {
    const f = await fixture();
    try {
      const service = await ExecutionWorkspaceService.create({
        chat2codexHome: f.home, codexBin: "codex", sandboxProbe: verifiedProbe,
      });
      await expect(service.prepare({ taskId: "../escape", workspaceRoot: f.workspace, intent: "general" })).rejects.toThrow(/task id/i);
      await expect(service.prepare({ taskId: taskA, workspaceRoot: path.join(f.root, "missing"), intent: "general" })).rejects.toThrow(/workspace/i);

      if (await supportsFileSymlinks()) {
        const link = path.join(f.root, "workspace-link");
        await symlink(f.workspace, link, "dir");
        await expect(service.prepare({ taskId: taskA, workspaceRoot: link, intent: "general" })).rejects.toThrow(/symlink/i);
      }

      await initGitRepository(f.workspace);
      const dirtyDestination = path.join(f.home, "worktrees", taskA);
      await mkdir(dirtyDestination, { recursive: true });
      await writeFile(path.join(dirtyDestination, "foreign.txt"), "do not reuse");
      await expect(service.prepare({ taskId: taskA, workspaceRoot: f.workspace, intent: "general" })).rejects.toThrow(/destination|worktree/i);
      await execFileAsync("git", ["-C", f.workspace, "branch", `chat2codex/${taskB}`]);
      await expect(service.prepare({ taskId: taskB, workspaceRoot: f.workspace, intent: "general" })).rejects.toThrow(/git|worktree|branch/i);
    } finally {
      await cleanup(f.root);
    }
  });
});

const installedCodexBin = process.env.CHAT2CODEX_TEST_CODEX_BIN;
const installedCodexTest = installedCodexBin ? test : test.skip;

installedCodexTest("installed Codex enforces the output-only sandbox contract", async () => {
  const result = await probeInstalledCodexOutputOnlySandbox(installedCodexBin!);
  expect(result).toMatchObject({ verified: true });
  expect(result.codexVersion).toBeTruthy();
}, 120_000);
