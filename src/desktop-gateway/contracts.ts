import { z } from "zod";

export const gatewayEndpointKinds = [
  "status",
  "desktop_heartbeat",
  "takeover_desktop",
  "release_bridge",
  "user_prompt_submit",
  "stop_wake",
] as const;

export const gatewayDecisionCodes = [
  "allow",
  "block",
  "accepted",
  "not_found",
  "stale_generation",
  "ownership_uncertain",
  "authentication_failed",
  "integrity_conflict",
] as const;

export type GatewayEndpointKind = typeof gatewayEndpointKinds[number];
export type GatewayDecisionCode = typeof gatewayDecisionCodes[number];

const uuid = z.string().uuid();
const opaqueId = z.string().trim().min(1).max(160).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const timestamp = z.iso.datetime({ offset: true });
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const commitment = z.string().regex(/^[0-9a-f]{64}$/u);

const statusRequestSchema = z.object({
  kind: z.literal("status"), requestId: uuid, rootThreadId: opaqueId,
}).strict();
const heartbeatRequestSchema = z.object({
  kind: z.literal("desktop_heartbeat"), requestId: uuid, bindingId: opaqueId,
  expectedGeneration: generation, ownerInstanceId: opaqueId, observedAt: timestamp,
}).strict();
const takeoverRequestSchema = z.object({
  kind: z.literal("takeover_desktop"), requestId: uuid, bindingId: opaqueId,
  expectedGeneration: generation, ownerInstanceId: opaqueId, observedAt: timestamp,
}).strict();
const releaseRequestSchema = z.object({
  kind: z.literal("release_bridge"), requestId: uuid, bindingId: opaqueId,
  expectedGeneration: generation, observedAt: timestamp,
}).strict();
const userPromptSubmitRequestSchema = z.object({
  kind: z.literal("user_prompt_submit"), requestId: uuid, sessionId: opaqueId,
  turnId: opaqueId, promptCommitment: commitment, observedAt: timestamp,
  controlKind: z.enum(["takeover", "release_request"]).optional(),
}).strict();
const stopWakeRequestSchema = z.object({
  kind: z.literal("stop_wake"), eventId: uuid, sessionId: opaqueId,
  turnId: opaqueId, observedAt: timestamp,
}).strict();

export const gatewayRequestSchema = z.discriminatedUnion("kind", [
  statusRequestSchema, heartbeatRequestSchema, takeoverRequestSchema,
  releaseRequestSchema, userPromptSubmitRequestSchema, stopWakeRequestSchema,
]);

export const gatewayResponseSchema = z.object({
  requestId: uuid,
  decision: z.enum(gatewayDecisionCodes),
  generation: generation.optional(),
  fenceId: opaqueId.optional(),
  message: z.string().trim().min(1).max(500).optional(),
}).strict();

export type GatewayRequest = z.infer<typeof gatewayRequestSchema>;
export type StatusRequest = z.infer<typeof statusRequestSchema>;
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type TakeoverRequest = z.infer<typeof takeoverRequestSchema>;
export type ReleaseRequest = z.infer<typeof releaseRequestSchema>;
export type UserPromptSubmitRequest = z.infer<typeof userPromptSubmitRequestSchema>;
export type StopWakeRequest = z.infer<typeof stopWakeRequestSchema>;
export type DesktopGatewayResponse = z.infer<typeof gatewayResponseSchema>;

export function parseGatewayRequest(value: unknown): GatewayRequest {
  return gatewayRequestSchema.parse(value);
}

export function parseGatewayResponse(value: unknown): DesktopGatewayResponse {
  return gatewayResponseSchema.parse(value);
}

export interface DesktopGatewayController {
  status(request: StatusRequest): Promise<DesktopGatewayResponse>;
  heartbeat(request: HeartbeatRequest): Promise<DesktopGatewayResponse>;
  takeover(request: TakeoverRequest): Promise<DesktopGatewayResponse>;
  release(request: ReleaseRequest): Promise<DesktopGatewayResponse>;
  submitPrompt(request: UserPromptSubmitRequest): Promise<DesktopGatewayResponse>;
  wake(request: StopWakeRequest): Promise<DesktopGatewayResponse>;
}
