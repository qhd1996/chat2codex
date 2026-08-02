import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { DeliverableStager } from "../src/core/deliverable-stager.js";
import { expectPrivateFileMode, isWindows, supportsFileSymlinks } from "./helpers/platform.js";

const taskId = "tsk_0123456789abcdef01234567";
const jobId = "job_0123456789abcdef";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DeliverableStager", () => {
  test("snapshots canonical workspace files immutably with content-derived types", async () => {
    const fixture = await createFixture();
    const samples = [
      ["picture.bin", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png")]), "image", "image/png"],
      ["photo.dat", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), "image", "image/jpeg"],
      ["animation.raw", Buffer.from("GIF89a_payload"), "image", "image/gif"],
      ["web.raw", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPpayload")]), "image", "image/webp"],
      ["not-really.png", Buffer.from("ordinary file"), "file", "application/octet-stream"],
    ] as const;
    const paths: string[] = [];
    for (const [name, bytes] of samples) {
      const file = path.join(fixture.workspace, name);
      await writeFile(file, bytes);
      paths.push(await realpath(file));
    }

    const staged = await fixture.stager.stage({
      taskId, jobId, workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
      isolationMode: "canonical_fifo", paths,
    });

    expect(staged).toHaveLength(samples.length);
    for (let index = 0; index < staged.length; index += 1) {
      const item = staged[index]!;
      const [name, bytes, kind, mediaType] = samples[index]!;
      expect(item).toMatchObject({
        sourcePath: paths[index], fileName: name, kind, mediaType, size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      expect(item.stagedPath).toStartWith(path.join(fixture.home, "outbound", taskId, jobId) + path.sep);
      expect(await readFile(item.stagedPath)).toEqual(bytes);
      expectPrivateFileMode((await stat(item.stagedPath)).mode);
    }
    if (!isWindows) expect((await stat(path.dirname(staged[0]!.stagedPath))).mode & 0o777).toBe(0o700);

    await writeFile(paths[0]!, "changed after staging");
    expect(await readFile(staged[0]!.stagedPath)).toEqual(samples[0]![1]);
  });

  test("allows the exact private execution directory only for output-only tasks", async () => {
    const fixture = await createFixture();
    const executionCwd = path.join(fixture.workspace, "outputs", "tasks", taskId);
    await mkdir(executionCwd, { recursive: true });
    const output = path.join(executionCwd, "answer.txt");
    await writeFile(output, "answer");

    const staged = await fixture.stager.stage({
      taskId, jobId, workspaceRoot: fixture.workspace, executionCwd, isolationMode: "output_only", paths: [output],
    });
    expect(await readFile(staged[0]!.stagedPath, "utf8")).toBe("answer");

    await expect(fixture.stager.stage({
      taskId, jobId: "job_other", workspaceRoot: fixture.workspace, executionCwd: fixture.root,
      isolationMode: "output_only", paths: [output],
    })).rejects.toThrow(/private execution|output-only/i);
  });

  test("allows only the exact task-owned Git worktree execution directory", async () => {
    const fixture = await createFixture();
    const executionCwd = path.join(fixture.home, "worktrees", taskId);
    await mkdir(executionCwd, { recursive: true });
    const output = path.join(executionCwd, "answer.txt");
    await writeFile(output, "worktree answer");

    const staged = await fixture.stager.stage({
      taskId, jobId, workspaceRoot: fixture.workspace, executionCwd, isolationMode: "git_worktree", paths: [output],
    });
    expect(await readFile(staged[0]!.stagedPath, "utf8")).toBe("worktree answer");

    const otherExecutionCwd = path.join(fixture.home, "worktrees", "tsk_aaaaaaaaaaaaaaaaaaaaaaaa");
    await mkdir(otherExecutionCwd, { recursive: true });
    const otherOutput = path.join(otherExecutionCwd, "other.txt");
    await writeFile(otherOutput, "other task");
    await expect(fixture.stager.stage({
      taskId, jobId: "job_wrong_worktree", workspaceRoot: fixture.workspace, executionCwd: otherExecutionCwd,
      isolationMode: "git_worktree", paths: [otherOutput],
    })).rejects.toThrow(/task.*worktree|exact.*worktree|execution directory/i);
  });

  test("rejects relative, missing, directory, outside-root, and duplicate canonical paths", async () => {
    const fixture = await createFixture();
    const inside = path.join(fixture.workspace, "inside.txt");
    const outside = path.join(fixture.root, "outside.txt");
    await writeFile(inside, "inside");
    await writeFile(outside, "outside");

    for (const [suffix, candidate, pattern] of [
      ["relative", "inside.txt", /absolute/i],
      ["missing", path.join(fixture.workspace, "missing.txt"), /exist|missing/i],
      ["directory", fixture.workspace, /regular file/i],
      ["outside", outside, /authorized root/i],
    ] as const) {
      await expect(fixture.stager.stage({
        taskId, jobId: `job_${suffix}`, workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
        isolationMode: "canonical_fifo", paths: [candidate],
      })).rejects.toThrow(pattern);
    }

    await expect(fixture.stager.stage({
      taskId, jobId: "job_duplicate", workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
      isolationMode: "canonical_fifo", paths: [inside, inside],
    })).rejects.toThrow(/duplicate/i);
  });

  test("rejects source symlinks and paths traversing symlinked directories", async () => {
    if (!(await supportsFileSymlinks())) return;
    const fixture = await createFixture();
    const outside = path.join(fixture.root, "outside.txt");
    const directLink = path.join(fixture.workspace, "direct-link.txt");
    const outsideDirectory = path.join(fixture.root, "outside-dir");
    const directoryLink = path.join(fixture.workspace, "linked-dir");
    await writeFile(outside, "secret");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "nested.txt"), "secret");
    await symlink(outside, directLink, "file");
    await symlink(outsideDirectory, directoryLink, "dir");

    for (const [suffix, candidate] of [
      ["file_link", directLink],
      ["dir_link", path.join(directoryLink, "nested.txt")],
    ]) {
      await expect(fixture.stager.stage({
        taskId, jobId: `job_${suffix}`, workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
        isolationMode: "canonical_fifo", paths: [candidate],
      })).rejects.toThrow(/symlink|canonical|authorized root/i);
    }
  });

  test("enforces file count, per-file bytes, and per-turn bytes before publishing snapshots", async () => {
    const fixture = await createFixture({ maxCount: 2, maxFileBytes: 5, maxTotalBytes: 8 });
    const one = path.join(fixture.workspace, "one.txt");
    const two = path.join(fixture.workspace, "two.txt");
    const three = path.join(fixture.workspace, "three.txt");
    await writeFile(one, "12345");
    await writeFile(two, "1234");
    await writeFile(three, "1");

    await expect(fixture.stager.stage({
      taskId, jobId: "job_count", workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
      isolationMode: "canonical_fifo", paths: [one, two, three],
    })).rejects.toThrow(/count|2/);
    await writeFile(three, "123456");
    await expect(fixture.stager.stage({
      taskId, jobId: "job_file_bytes", workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
      isolationMode: "canonical_fifo", paths: [three],
    })).rejects.toThrow(/per-file|5|file.*limit/i);
    await expect(fixture.stager.stage({
      taskId, jobId: "job_total_bytes", workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
      isolationMode: "canonical_fifo", paths: [one, two],
    })).rejects.toThrow(/per-turn|8|total/i);

    await expect(access(path.join(fixture.home, "outbound", taskId, "job_total_bytes"))).rejects.toThrow();
  });

  test("rejects a dirty preexisting job destination without deleting it", async () => {
    const fixture = await createFixture();
    const source = path.join(fixture.workspace, "report.txt");
    const jobDirectory = path.join(fixture.home, "outbound", taskId, jobId);
    const marker = path.join(jobDirectory, "keep.txt");
    await writeFile(source, "report");
    await mkdir(jobDirectory, { recursive: true });
    await writeFile(marker, "keep");

    await expect(fixture.stager.stage({
      taskId, jobId, workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
      isolationMode: "canonical_fifo", paths: [source],
    })).rejects.toThrow(/already exists|dirty/i);
    expect(await readFile(marker, "utf8")).toBe("keep");
  });

  test("detects source mutation during copy and removes only its newly-created job directory", async () => {
    const fixture = await createFixture({ maxFileBytes: 32 * 1024 ** 2, maxTotalBytes: 32 * 1024 ** 2 });
    const source = path.join(fixture.workspace, "large.bin");
    const destination = path.join(fixture.home, "outbound", taskId, jobId, "01-large.bin");
    await writeFile(source, Buffer.alloc(16 * 1024 ** 2, 0x41));

    const staging = fixture.stager.stage({
      taskId, jobId, workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
      isolationMode: "canonical_fifo", paths: [source],
    });
    await waitForPath(destination);
    await writeFile(source, Buffer.alloc(16 * 1024 ** 2, 0x42));

    await expect(staging).rejects.toThrow(/changed|mutated/i);
    await expect(access(path.dirname(destination))).rejects.toThrow();
  });

  test("cleanup removes staged trees without following symlinks", async () => {
    if (!(await supportsFileSymlinks())) return;
    const fixture = await createFixture();
    const source = path.join(fixture.workspace, "report.txt");
    const outsideDirectory = path.join(fixture.root, "must-survive");
    const outsideFile = path.join(outsideDirectory, "keep.txt");
    await writeFile(source, "report");
    const staged = await fixture.stager.stage({
      taskId, jobId, workspaceRoot: fixture.workspace, executionCwd: fixture.workspace,
      isolationMode: "canonical_fifo", paths: [source],
    });
    await mkdir(outsideDirectory);
    await writeFile(outsideFile, "keep");
    await symlink(outsideDirectory, path.join(path.dirname(staged[0]!.stagedPath), "outside-link"), "dir");

    await fixture.stager.cleanup({ taskId, jobId });

    expect(await readFile(outsideFile, "utf8")).toBe("keep");
    await expect(access(path.dirname(staged[0]!.stagedPath))).rejects.toThrow();
  });
});

async function createFixture(overrides: Partial<{ maxCount: number; maxFileBytes: number; maxTotalBytes: number }> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-deliverable-stager-"));
  roots.push(root);
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  await Promise.all([mkdir(home), mkdir(workspace)]);
  return {
    root, home: await realpath(home), workspace: await realpath(workspace),
    stager: new DeliverableStager({
      chat2codexHome: home, maxCount: 16, maxFileBytes: 25 * 1024 ** 2, maxTotalBytes: 50 * 1024 ** 2,
      ...overrides,
    }),
  };
}

async function waitForPath(candidate: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return;
    } catch {
      // The exclusive destination is created asynchronously after source validation.
    }
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for staging copy to begin.");
}
