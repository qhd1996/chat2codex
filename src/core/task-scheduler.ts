import path from "node:path";
import type { IsolationMode } from "../state/types.js";

export interface TaskScheduleRequest {
  taskId: string;
  workspaceRoot: string;
  isolationMode: IsolationMode;
}

export type TaskQueueReason = "task_fifo" | "workspace_fifo" | "global_capacity";

export interface TaskSchedulerSnapshot {
  global: {
    capacity: number;
    active: number;
    waiting: number;
  };
  jobs: TaskSchedulerJobSnapshot[];
}

export interface TaskSchedulerJobSnapshot extends TaskScheduleRequest {
  scheduleId: string;
  state: "queued" | "running";
  queueReason?: TaskQueueReason;
  enqueuedAt: string;
  startedAt?: string;
}

export interface TaskSchedulerOptions {
  maxConcurrentRuns: number;
  now?: () => Date;
}

interface QueuedJob<T> extends TaskScheduleRequest {
  scheduleId: string;
  rootKey: string;
  operation: () => Promise<T> | T;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: string;
}

interface RunningJob extends TaskScheduleRequest {
  scheduleId: string;
  rootKey: string;
  enqueuedAt: string;
  startedAt: string;
}

export class TaskScheduleCancelledError extends Error {
  readonly taskId: string;
  readonly scheduleId: string;

  constructor(taskId: string, scheduleId: string) {
    super(`Task schedule ${scheduleId} for ${taskId} was cancelled while waiting.`);
    this.name = "TaskScheduleCancelledError";
    this.taskId = taskId;
    this.scheduleId = scheduleId;
  }
}

export class TaskScheduler {
  private readonly capacity: number;
  private readonly now: () => Date;
  private readonly queued: QueuedJob<unknown>[] = [];
  private readonly running = new Map<string, RunningJob>();
  private readonly activeTasks = new Set<string>();
  private readonly activeCanonicalRoots = new Set<string>();
  private sequence = 0;
  private dispatchPending = false;

  constructor(options: TaskSchedulerOptions) {
    if (!Number.isSafeInteger(options.maxConcurrentRuns) || options.maxConcurrentRuns <= 0) {
      throw new Error("maxConcurrentRuns must be a positive safe integer.");
    }
    this.capacity = options.maxConcurrentRuns;
    this.now = options.now ?? (() => new Date());
  }

  schedule<T>(request: TaskScheduleRequest, operation: () => Promise<T> | T): Promise<T> {
    try {
      validateRequest(request);
      if (typeof operation !== "function") throw new Error("Scheduled operation must be a function.");
    } catch (error) {
      return Promise.reject(error);
    }

    const scheduleId = `schedule-${++this.sequence}`;
    const root = path.resolve(request.workspaceRoot);
    return new Promise<T>((resolve, reject) => {
      this.queued.push({
        taskId: request.taskId,
        workspaceRoot: root,
        isolationMode: request.isolationMode,
        scheduleId,
        rootKey: platformPathKey(root),
        operation,
        resolve,
        reject,
        enqueuedAt: this.now().toISOString(),
      } as QueuedJob<unknown>);
      this.requestDispatch();
    });
  }

  cancel(taskId: string): number {
    if (typeof taskId !== "string" || !taskId.trim()) return 0;
    const cancelled: QueuedJob<unknown>[] = [];
    for (let index = this.queued.length - 1; index >= 0; index -= 1) {
      const job = this.queued[index]!;
      if (job.taskId !== taskId) continue;
      cancelled.push(job);
      this.queued.splice(index, 1);
    }
    cancelled.reverse();
    for (const job of cancelled) job.reject(new TaskScheduleCancelledError(job.taskId, job.scheduleId));
    if (cancelled.length > 0) this.requestDispatch();
    return cancelled.length;
  }

  snapshot(): TaskSchedulerSnapshot {
    const jobs: TaskSchedulerJobSnapshot[] = [];
    for (const job of this.running.values()) {
      jobs.push({
        taskId: job.taskId, workspaceRoot: job.workspaceRoot, isolationMode: job.isolationMode,
        scheduleId: job.scheduleId, state: "running", enqueuedAt: job.enqueuedAt, startedAt: job.startedAt,
      });
    }
    this.queued.forEach((job, index) => {
      jobs.push({
        taskId: job.taskId, workspaceRoot: job.workspaceRoot, isolationMode: job.isolationMode,
        scheduleId: job.scheduleId, state: "queued", queueReason: this.queueReason(job, index), enqueuedAt: job.enqueuedAt,
      });
    });
    return {
      global: { capacity: this.capacity, active: this.running.size, waiting: this.queued.length },
      jobs,
    };
  }

  private requestDispatch(): void {
    if (this.dispatchPending) return;
    this.dispatchPending = true;
    queueMicrotask(() => {
      this.dispatchPending = false;
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.running.size < this.capacity) {
      const index = this.queued.findIndex((job, candidateIndex) => !this.blockedByTask(job, candidateIndex) && !this.blockedByWorkspace(job, candidateIndex));
      if (index < 0) return;
      const job = this.queued.splice(index, 1)[0]!;
      const running: RunningJob = {
        taskId: job.taskId, workspaceRoot: job.workspaceRoot, isolationMode: job.isolationMode,
        scheduleId: job.scheduleId, rootKey: job.rootKey, enqueuedAt: job.enqueuedAt, startedAt: this.now().toISOString(),
      };
      this.running.set(job.scheduleId, running);
      this.activeTasks.add(job.taskId);
      if (job.isolationMode === "canonical_fifo") this.activeCanonicalRoots.add(job.rootKey);
      void Promise.resolve().then(job.operation).then((value) => {
        this.release(job);
        job.resolve(value);
      }, (error: unknown) => {
        this.release(job);
        job.reject(error);
      });
    }
  }

  private release(job: QueuedJob<unknown>): void {
        this.running.delete(job.scheduleId);
        this.activeTasks.delete(job.taskId);
        if (job.isolationMode === "canonical_fifo") this.activeCanonicalRoots.delete(job.rootKey);
        this.requestDispatch();
  }

  private queueReason(job: QueuedJob<unknown>, index: number): TaskQueueReason {
    if (this.blockedByTask(job, index)) return "task_fifo";
    if (this.blockedByWorkspace(job, index)) return "workspace_fifo";
    return "global_capacity";
  }

  private blockedByTask(job: QueuedJob<unknown>, index: number): boolean {
    if (this.activeTasks.has(job.taskId)) return true;
    return this.queued.slice(0, index).some((earlier) => earlier.taskId === job.taskId);
  }

  private blockedByWorkspace(job: QueuedJob<unknown>, index: number): boolean {
    if (job.isolationMode !== "canonical_fifo") return false;
    if (this.activeCanonicalRoots.has(job.rootKey)) return true;
    return this.queued.slice(0, index).some((earlier) => earlier.isolationMode === "canonical_fifo" && earlier.rootKey === job.rootKey);
  }
}

function validateRequest(request: TaskScheduleRequest): void {
  if (typeof request.taskId !== "string" || !request.taskId.trim()) throw new Error("Task ID is required for scheduling.");
  if (request.taskId.length > 128) throw new Error("Task ID is too long for scheduling.");
  if (typeof request.workspaceRoot !== "string" || !path.isAbsolute(request.workspaceRoot)) {
    throw new Error("Workspace root must be an absolute path.");
  }
  if (!(["canonical_fifo", "git_worktree", "output_only"] as const).includes(request.isolationMode)) {
    throw new Error("Unsupported task isolation mode.");
  }
}

function platformPathKey(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}
