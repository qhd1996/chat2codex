import type {
  DesktopGatewayController,
  DesktopGatewayResponse,
  HeartbeatRequest,
  ReleaseRequest,
  StatusRequest,
  StopWakeRequest,
  TakeoverRequest,
  UserPromptSubmitRequest,
  GatewayRequest,
} from "../desktop-gateway/contracts.js";
import type { DurableMutationReplay } from "../desktop-gateway/server.js";
import type { BridgeState, DesktopBinding } from "../state/types.js";
import { DesktopOwnershipCoordinator } from "./desktop-ownership.js";

export interface Phase3GatewayControllerOptions {
  ownership: DesktopOwnershipCoordinator;
  readState<T>(read: (state: BridgeState) => T | Promise<T>): Promise<T>;
  mutateState<T>(mutation: (state: BridgeState) => T | Promise<T>): Promise<T>;
  onWake?: (bindingId: string) => void;
}

export class DurableGatewayRequestReplay implements DurableMutationReplay {
  constructor(private readonly state: Pick<Phase3GatewayControllerOptions, "mutateState">) {}

  checkAndRecord(
    requestId: string,
    bodySha256: string,
    request: GatewayRequest,
  ): Promise<"new" | "idempotent" | "conflict"> {
    return this.state.mutateState((state) => {
      const binding = bindingForRequest(state, request);
      if (!binding) return "new";
      const key = `replay:${requestId}`;
      const prior = binding.processedMutationIds[key];
      if (prior !== undefined) return prior === bodySha256 ? "idempotent" : "conflict";
      binding.processedMutationIds[key] = bodySha256;
      const keys = Object.keys(binding.processedMutationIds);
      for (const old of keys.slice(0, Math.max(0, keys.length - 256))) delete binding.processedMutationIds[old];
      return "new";
    });
  }
}

export class Phase3GatewayController implements DesktopGatewayController {
  constructor(private readonly options: Phase3GatewayControllerOptions) {}

  status(request: StatusRequest): Promise<DesktopGatewayResponse> {
    return this.options.readState((state) => {
      const binding = bindingByRoot(state, request.rootThreadId);
      if (!binding) return response(request.requestId, "not_found");
      return response(request.requestId, "accepted", binding, statusSummary(binding));
    });
  }

  heartbeat(request: HeartbeatRequest): Promise<DesktopGatewayResponse> {
    return this.mutate(request.requestId, request.bindingId, (state) => this.options.ownership.heartbeat(state, {
      mutationId: request.requestId, bindingId: request.bindingId,
      expectedGeneration: request.expectedGeneration, ownerInstanceId: request.ownerInstanceId,
      observedAt: request.observedAt,
    }));
  }

  takeover(request: TakeoverRequest): Promise<DesktopGatewayResponse> {
    return this.mutate(request.requestId, request.bindingId, (state) => this.options.ownership.takeover(state, {
      mutationId: request.requestId, bindingId: request.bindingId,
      expectedGeneration: request.expectedGeneration, ownerInstanceId: request.ownerInstanceId,
      observedAt: request.observedAt,
    }));
  }

  release(request: ReleaseRequest): Promise<DesktopGatewayResponse> {
    return this.mutate(request.requestId, request.bindingId, (state) => this.options.ownership.requestRelease(state, {
      mutationId: request.requestId, bindingId: request.bindingId,
      expectedGeneration: request.expectedGeneration, observedAt: request.observedAt,
    }));
  }

  async submitPrompt(request: UserPromptSubmitRequest): Promise<DesktopGatewayResponse> {
    try {
      return await this.options.mutateState((state) => {
        const binding = bindingByRoot(state, request.sessionId);
        if (!binding) return response(request.requestId, "not_found");
        if (binding.owner === "uncertain") return response(request.requestId, "ownership_uncertain", binding);
        try {
          if (request.controlKind === "takeover") {
          const taken = this.options.ownership.takeover(state, {
            mutationId: derivedMutationId(request.requestId, "takeover"),
            bindingId: binding.bindingId, expectedGeneration: binding.generation,
            ownerInstanceId: derivedOwnerInstanceId(request.requestId), observedAt: request.observedAt,
          });
          const recorded = this.options.ownership.recordControlTurn(state, {
            mutationId: derivedMutationId(request.requestId, "control"),
            bindingId: taken.bindingId, expectedGeneration: taken.generation, turnId: request.turnId,
            kind: request.controlKind, promptCommitment: request.promptCommitment, recordedAt: request.observedAt,
          });
            return response(request.requestId, "accepted", recorded);
          }
          if (request.controlKind === "release_request") {
          const recorded = this.options.ownership.recordControlTurn(state, {
            mutationId: derivedMutationId(request.requestId, "control"),
            bindingId: binding.bindingId, expectedGeneration: binding.generation, turnId: request.turnId,
            kind: request.controlKind, promptCommitment: request.promptCommitment, recordedAt: request.observedAt,
          });
          const released = this.options.ownership.requestRelease(state, {
            mutationId: derivedMutationId(request.requestId, "release"),
            bindingId: recorded.bindingId, expectedGeneration: recorded.generation, observedAt: request.observedAt,
          });
            return response(request.requestId, "accepted", released);
          }
          if (binding.owner !== "desktop") return response(request.requestId, "block", binding);
          const fenced = this.options.ownership.createFence(state, {
            requestId: request.requestId, bindingId: binding.bindingId,
            expectedGeneration: binding.generation, turnId: request.turnId,
            promptCommitment: request.promptCommitment, issuedAt: request.observedAt,
          });
          return {
            ...response(request.requestId, "allow", fenced),
            fenceId: request.turnId,
          };
        } catch (error) {
          const current = state.desktopGateway?.bindings[binding.bindingId];
          if (current?.owner === "uncertain") {
            return response(request.requestId, "ownership_uncertain", current);
          }
          throw error;
        }
      });
    } catch (error) {
      return failureResponse(request.requestId, error);
    }
  }

  async wake(request: StopWakeRequest): Promise<DesktopGatewayResponse> {
    try {
      return await this.options.mutateState((state) => {
        const binding = bindingByRoot(state, request.sessionId);
        if (!binding) return response(request.eventId, "not_found");
        const updated = this.options.ownership.enqueueWake(state, {
          eventId: request.eventId, bindingId: binding.bindingId,
          turnId: request.turnId, observedAt: request.observedAt,
        });
        this.options.onWake?.(updated.bindingId);
        return response(request.eventId, "accepted", updated);
      });
    } catch (error) {
      return failureResponse(request.eventId, error);
    }
  }

  private async mutate(
    requestId: string,
    bindingId: string,
    mutation: (state: BridgeState) => DesktopBinding,
  ): Promise<DesktopGatewayResponse> {
    try {
      return await this.options.mutateState((state) => {
        const existing = state.desktopGateway?.bindings[bindingId];
        if (existing?.owner === "uncertain") {
          return response(requestId, "ownership_uncertain", existing);
        }
        try {
          return response(requestId, "accepted", mutation(state));
        } catch (error) {
          const current = state.desktopGateway?.bindings[bindingId];
          if (current?.owner === "uncertain" && /expired.*uncertain|integrity conflict/i.test(error instanceof Error ? error.message : "")) {
            return response(requestId, "ownership_uncertain", current);
          }
          throw error;
        }
      });
    } catch (error) {
      return failureResponse(requestId, error);
    }
  }
}

export function claimBoundBridgeStart(
  state: BridgeState,
  input: { taskId: string; jobId: string; observedAt: string },
): { bindingId: string; generation: number } | undefined {
  const binding = Object.values(state.desktopGateway?.bindings ?? {})
    .find((candidate) => candidate.taskId === input.taskId);
  if (!binding) return undefined;
  if (binding.owner !== "bridge") {
    throw new Error(`Bound bridge start requires bridge ownership, not ${binding.owner}.`);
  }
  if (binding.activeStartFence || binding.releaseRequested || binding.pendingWakeIds.length > 0) {
    throw new Error("Bound bridge start is blocked by unresolved Desktop obligations.");
  }
  const task = state.tasks[input.taskId];
  const job = state.jobs[input.jobId];
  if (!task || task.threadId !== binding.rootThreadId || !job || job.taskId !== task.taskId ||
      job.threadId !== binding.rootThreadId || job.status !== "queued") {
    throw new Error("Bound bridge start does not match the durable root job.");
  }
  job.status = "running";
  job.startedAt = input.observedAt;
  job.updatedAt = input.observedAt;
  job.desktopBindingId = binding.bindingId;
  job.desktopGeneration = binding.generation;
  return { bindingId: binding.bindingId, generation: binding.generation };
}

function bindingByRoot(state: BridgeState, rootThreadId: string): DesktopBinding | undefined {
  return Object.values(state.desktopGateway?.bindings ?? {})
    .find((binding) => binding.rootThreadId === rootThreadId);
}

function bindingForRequest(state: BridgeState, request: GatewayRequest): DesktopBinding | undefined {
  if (request.kind === "status") return bindingByRoot(state, request.rootThreadId);
  if (request.kind === "user_prompt_submit" || request.kind === "stop_wake") {
    return bindingByRoot(state, request.sessionId);
  }
  return state.desktopGateway?.bindings[request.bindingId];
}

function response(
  requestId: string,
  decision: DesktopGatewayResponse["decision"],
  binding?: DesktopBinding,
  message?: string,
): DesktopGatewayResponse {
  return { requestId, decision, ...(binding ? { generation: binding.generation } : {}), ...(message ? { message } : {}) };
}

function failureResponse(requestId: string, error: unknown): DesktopGatewayResponse {
  const message = error instanceof Error ? error.message : "";
  if (/not found/i.test(message)) return response(requestId, "not_found");
  if (/stale generation/i.test(message)) return response(requestId, "stale_generation");
  if (/uncertain/i.test(message)) return response(requestId, "ownership_uncertain");
  if (/integrity conflict/i.test(message)) return response(requestId, "integrity_conflict");
  return response(requestId, "block");
}

function statusSummary(binding: DesktopBinding): string {
  return [
    `owner=${binding.owner}`,
    `fence=${binding.activeStartFence ? "active" : "clear"}`,
    `release=${binding.releaseRequested ? "pending" : "clear"}`,
    `wake=${binding.pendingWakeIds.length > 0 ? "pending" : "clear"}`,
  ].join(";");
}

function derivedMutationId(requestId: string, suffix: string): string {
  return `${requestId}:${suffix}`;
}

function derivedOwnerInstanceId(requestId: string): string {
  void requestId;
  return "desktop-control";
}
