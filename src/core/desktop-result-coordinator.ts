import type { AuthoritativeCodexThread } from "../agent/codex-runner.js";
import type { BridgeState, DesktopBinding } from "../state/types.js";
import { desktopGatewayControlPrompts } from "../desktop-gateway/contracts.js";
import { DesktopReconciler, type DesktopReconciliationPlan } from "./desktop-reconciler.js";
import type { DeliverableStager, StagedDeliverable } from "./deliverable-stager.js";
import type { MediaOutbox } from "./media-outbox.js";

export interface DesktopResultCoordinatorOptions {
  readThread(threadId: string): Promise<AuthoritativeCodexThread>;
  readState<T>(read: (state: BridgeState) => T | Promise<T>): Promise<T>;
  mutateState<T>(mutation: (state: BridgeState) => T | Promise<T>): Promise<T>;
  stager: DeliverableStager;
  mediaOutbox: MediaOutbox;
  now?: () => string;
  controlPromptCommitments?: Record<"takeover" | "release_request", string>;
}

export type DesktopResultOutcome = { kind: "noop" } | { kind: "committed"; deliveryCount: number; jobId?: string } | { kind: "uncertain"; error: string };

export class DesktopResultCoordinator {
  private readonly reconciler = new DesktopReconciler();
  private controlPromptCommitments: Record<"takeover" | "release_request", string> | undefined;
  constructor(private readonly options: DesktopResultCoordinatorOptions) {}
  setControlPromptCommitments(value: Record<"takeover" | "release_request", string>): void { this.controlPromptCommitments = { ...value }; }

  async reconcileBinding(bindingId: string): Promise<DesktopResultOutcome> {
    const snapshot = await this.options.readState((state) => {
      const binding = state.desktopGateway?.bindings[bindingId];
      const task = binding ? state.tasks[binding.taskId] : undefined;
      return binding && task ? { binding: structuredClone(binding), task: structuredClone(task) } : undefined;
    });
    if (!snapshot) return { kind: "noop" };
    const thread = await this.options.readThread(snapshot.binding.rootThreadId);
    const result = this.reconciler.reconcile({
      binding: snapshot.binding, thread, controlPromptCommitments: this.controlPromptCommitments ?? this.options.controlPromptCommitments,
      controlPrompts: desktopGatewayControlPrompts,
    });
    if (result.kind === "noop") return result;
    if (result.kind === "uncertain") return this.markUncertain(bindingId, snapshot.binding.generation, result.error);
    let staged: StagedDeliverable[] = [];
    const stagingJobId = stagingIdentity(result.plan);
    try {
      if (result.plan.declaredFiles.length > 0) {
        const referenced = await this.options.readState((state) => Object.values(state.outbox)
          .some((delivery) => delivery.idempotencyKey.startsWith(result.plan.identityPrefix + ":")));
        if (!referenced) await this.options.stager.cleanup({ taskId: snapshot.task.taskId, jobId: stagingJobId });
      }
      staged = await this.options.stager.stage({
        taskId: snapshot.task.taskId, jobId: stagingJobId, workspaceRoot: snapshot.task.workspaceRoot,
        executionCwd: snapshot.task.executionCwd, isolationMode: snapshot.task.isolationMode, paths: result.plan.declaredFiles,
      });
      return await this.options.mutateState((state) => this.commit(state, snapshot.binding, result.plan, staged));
    } catch (error) {
      if (staged.length > 0) await this.options.stager.cleanup({ taskId: snapshot.task.taskId, jobId: stagingJobId }).catch(() => undefined);
      if (error instanceof IntegrityConflict) return this.markUncertain(bindingId, snapshot.binding.generation, error.message);
      throw error;
    }
  }

  private commit(state: BridgeState, observed: DesktopBinding, plan: DesktopReconciliationPlan, staged: readonly StagedDeliverable[]): DesktopResultOutcome {
    const binding = state.desktopGateway?.bindings[observed.bindingId];
    const task = binding ? state.tasks[binding.taskId] : undefined;
    if (!binding || !task || binding.rootThreadId !== plan.rootThreadId || binding.generation !== observed.generation ||
        binding.lastReconciledTurnId !== observed.lastReconciledTurnId || binding.lastReconciledTurnIndex !== observed.lastReconciledTurnIndex ||
        binding.lastAuthoritativeDigest !== plan.priorDigest) throw new IntegrityConflict("Desktop binding changed during reconciliation.");
    if (plan.clearsStartFence && binding.activeStartFence?.turnId !== plan.turnId) throw new IntegrityConflict("Desktop start fence changed during reconciliation.");
    let deliveries = [] as ReturnType<MediaOutbox["appendDesktopResult"]>;
    try {
      deliveries = this.options.mediaOutbox.appendDesktopResult(state, {
        plan, taskId: task.taskId, conversationId: binding.conversationId, cwd: task.executionCwd, stagedFiles: staged, createdAt: (this.options.now ?? (() => new Date().toISOString()))(),
      });
    } catch (error) { throw new IntegrityConflict(error instanceof Error ? error.message : "Desktop outbox conflict."); }
    binding.lastReconciledTurnId = plan.turnId; binding.lastReconciledTurnIndex = plan.authoritativeTurnIndex;
    binding.lastAuthoritativeDigest = plan.authoritativeDigest; binding.lastMirroredTurnId = plan.turnId;
    if (plan.clearsStartFence) delete binding.activeStartFence;
    for (const wakeId of [...binding.pendingWakeIds]) {
      const wake = state.desktopGateway!.wakes[wakeId];
      if (wake?.turnId === plan.turnId) { delete state.desktopGateway!.wakes[wakeId]; binding.pendingWakeIds = binding.pendingWakeIds.filter((id) => id !== wakeId); }
    }
    binding.updatedAt = (this.options.now ?? (() => new Date().toISOString()))();
    return { kind: "committed", deliveryCount: deliveries.length, ...(deliveries[0] ? { jobId: deliveries[0].jobId } : {}) };
  }

  private async markUncertain(bindingId: string, generation: number, message: string): Promise<DesktopResultOutcome> {
    await this.options.mutateState((state) => {
      const binding = state.desktopGateway?.bindings[bindingId];
      if (binding && binding.generation === generation && binding.owner !== "disabled") {
        binding.owner = "uncertain"; binding.generation += 1; delete binding.ownerInstanceId; delete binding.leaseExpiresAt;
      }
    });
    return { kind: "uncertain", error: boundedError(message) };
  }
}

class IntegrityConflict extends Error {}
function stagingIdentity(plan: DesktopReconciliationPlan): string { return `desktop-${plan.bindingId}-${plan.originGeneration}-${plan.turnId}`; }
function boundedError(value: string): string { return value.replace(/\s+/gu, " " ).slice(0, 300); }
