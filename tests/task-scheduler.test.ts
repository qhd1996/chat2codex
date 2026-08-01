import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TaskScheduleCancelledError, TaskScheduler } from "../src/core/task-scheduler.js";
import type { IsolationMode } from "../src/state/types.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for scheduler state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-scheduler-"));
  const workspaceA = path.join(root, "a");
  const workspaceB = path.join(root, "b");
  await Promise.all([mkdir(workspaceA), mkdir(workspaceB)]);
  return { root, workspaceA: await realpath(workspaceA), workspaceB: await realpath(workspaceB) };
}

function request(taskId: string, workspaceRoot: string, isolationMode: IsolationMode) {
  return { taskId, workspaceRoot, isolationMode };
}

describe("TaskScheduler", () => {
  test("overlaps canonical FIFO work in different workspace roots", async () => {
    const f = await fixture();
    try {
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 2 });
      const gates = [deferred<void>(), deferred<void>()];
      const started: string[] = [];
      const first = scheduler.schedule(request("task-a", f.workspaceA, "canonical_fifo"), async () => { started.push("a"); await gates[0]!.promise; });
      const second = scheduler.schedule(request("task-b", f.workspaceB, "canonical_fifo"), async () => { started.push("b"); await gates[1]!.promise; });

      await waitFor(() => started.length === 2);
      expect(new Set(started)).toEqual(new Set(["a", "b"]));
      gates.forEach((gate) => gate.resolve());
      await Promise.all([first, second]);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  test("serializes same-root canonical FIFO work in arrival order", async () => {
    const f = await fixture();
    try {
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 4 });
      const firstGate = deferred<void>();
      const started: string[] = [];
      const first = scheduler.schedule(request("task-a", f.workspaceA, "canonical_fifo"), async () => { started.push("a"); await firstGate.promise; });
      const second = scheduler.schedule(request("task-b", f.workspaceA, "canonical_fifo"), async () => { started.push("b"); });

      await waitFor(() => started.length === 1);
      expect(started).toEqual(["a"]);
      expect(scheduler.snapshot().jobs).toContainEqual(expect.objectContaining({ taskId: "task-b", queueReason: "workspace_fifo" }));
      firstGate.resolve();
      await Promise.all([first, second]);
      expect(started).toEqual(["a", "b"]);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  test.each(["output_only", "git_worktree"] as const)("overlaps same-root %s tasks", async (isolationMode) => {
    const f = await fixture();
    try {
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 2 });
      const gates = [deferred<void>(), deferred<void>()];
      let running = 0;
      const run = (index: number) => scheduler.schedule(request(`task-${index}`, f.workspaceA, isolationMode), async () => { running += 1; await gates[index]!.promise; running -= 1; });
      const first = run(0);
      const second = run(1);
      await waitFor(() => running === 2);
      gates.forEach((gate) => gate.resolve());
      await Promise.all([first, second]);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  test("serializes an unverified output-only fallback represented as canonical FIFO", async () => {
    const f = await fixture();
    try {
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 2 });
      const gate = deferred<void>();
      const started: string[] = [];
      const first = scheduler.schedule(request("task-a", f.workspaceA, "canonical_fifo"), async () => { started.push("a"); await gate.promise; });
      const second = scheduler.schedule(request("task-b", f.workspaceA, "canonical_fifo"), async () => { started.push("b"); });
      await waitFor(() => started.length === 1);
      expect(started).toEqual(["a"]);
      gate.resolve();
      await Promise.all([first, second]);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  test("serializes turns belonging to one task", async () => {
    const f = await fixture();
    try {
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 4 });
      const gate = deferred<void>();
      const started: string[] = [];
      const first = scheduler.schedule(request("same-task", f.workspaceA, "output_only"), async () => { started.push("first"); await gate.promise; });
      const second = scheduler.schedule(request("same-task", f.workspaceA, "output_only"), async () => { started.push("second"); });
      await waitFor(() => started.length === 1);
      expect(scheduler.snapshot().jobs).toContainEqual(expect.objectContaining({ taskId: "same-task", queueReason: "task_fifo" }));
      gate.resolve();
      await Promise.all([first, second]);
      expect(started).toEqual(["first", "second"]);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  test("cancels a waiting task without starting its operation", async () => {
    const f = await fixture();
    try {
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 1 });
      const gate = deferred<void>();
      let secondStarted = false;
      const first = scheduler.schedule(request("task-a", f.workspaceA, "output_only"), async () => { await gate.promise; });
      const second = scheduler.schedule(request("task-b", f.workspaceB, "output_only"), async () => { secondStarted = true; });
      await waitFor(() => scheduler.snapshot().jobs.some((job) => job.taskId === "task-b" && job.queueReason === "global_capacity"));

      expect(scheduler.cancel("task-b")).toBe(1);
      await expect(second).rejects.toBeInstanceOf(TaskScheduleCancelledError);
      expect(secondStarted).toBe(false);
      gate.resolve();
      await first;
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  test("enforces global capacity and reports it in snapshots", async () => {
    const f = await fixture();
    try {
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 2 });
      const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
      let running = 0;
      let peak = 0;
      const jobs = gates.map((gate, index) => scheduler.schedule(request(`task-${index}`, index === 0 ? f.workspaceA : f.workspaceB, "output_only"), async () => {
        running += 1; peak = Math.max(peak, running); await gate.promise; running -= 1;
      }));
      await waitFor(() => running === 2 && scheduler.snapshot().global.waiting === 1);
      expect(scheduler.snapshot().global).toMatchObject({ capacity: 2, active: 2, waiting: 1 });
      gates[0]!.resolve();
      await waitFor(() => scheduler.snapshot().global.active === 2 && scheduler.snapshot().global.waiting === 0);
      gates[1]!.resolve(); gates[2]!.resolve();
      await Promise.all(jobs);
      expect(peak).toBe(2);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  test("releases task, workspace, and capacity locks after failure", async () => {
    const f = await fixture();
    try {
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 2 });
      const started: string[] = [];
      const first = scheduler.schedule(request("task-a", f.workspaceA, "canonical_fifo"), async () => { started.push("a"); throw new Error("boom"); });
      const sameTask = scheduler.schedule(request("task-a", f.workspaceB, "output_only"), async () => { started.push("same-task"); return 41; });
      const sameWorkspace = scheduler.schedule(request("task-b", f.workspaceA, "canonical_fifo"), async () => { started.push("same-workspace"); return 42; });
      await expect(first).rejects.toThrow("boom");
      await expect(Promise.all([sameTask, sameWorkspace])).resolves.toEqual([41, 42]);
      expect(started[0]).toBe("a");
      expect(new Set(started.slice(1))).toEqual(new Set(["same-task", "same-workspace"]));
      expect(scheduler.snapshot()).toMatchObject({ global: { active: 0, waiting: 0 }, jobs: [] });
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  test("releases scheduler state before the returned promise settles", async () => {
    const f = await fixture();
    try {
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 1 });
      await expect(scheduler.schedule(request("task-a", f.workspaceA, "canonical_fifo"), async () => 42)).resolves.toBe(42);
      expect(scheduler.snapshot()).toMatchObject({ global: { active: 0, waiting: 0 }, jobs: [] });
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  test("rejects invalid configuration and schedule metadata", async () => {
    const f = await fixture();
    try {
      expect(() => new TaskScheduler({ maxConcurrentRuns: 0 })).toThrow(/concurrent/i);
      const scheduler = new TaskScheduler({ maxConcurrentRuns: 1 });
      await expect(scheduler.schedule(request("", f.workspaceA, "output_only"), async () => undefined)).rejects.toThrow(/task/i);
      await expect(scheduler.schedule(request("task-a", "relative", "output_only"), async () => undefined)).rejects.toThrow(/absolute/i);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
