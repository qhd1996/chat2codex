import { randomUUID } from "node:crypto";

export interface ChatSession {
  /** Rotated whenever the chat starts or selects a different logical Codex session. */
  sessionEpoch: string;
  threadId?: string;
  cwd: string;
  chatType?: "direct" | "group";
  updatedAt: string;
  lastProjects?: ProjectSelection[];
  lastThreads?: ThreadSelection[];
  lastArchivedThreads?: ThreadSelection[];
  lastTurns?: TurnSelection[];
  lastRun?: LastRunSummary;
}

export type TaskStatus = "draft" | "queued" | "waiting_workspace" | "running" | "waiting_approval" | "waiting_input" | "stopping" | "completed" | "failed" | "interrupted" | "archived";
export type WorkspaceKind = "work" | "travel" | "personal" | "finance" | "ai_lab" | "learning" | "explicit";
export type IsolationMode = "canonical_fifo" | "git_worktree" | "output_only";

export interface RegisteredTask {
  taskId: string; conversationId: string; chatType: "direct" | "group"; senderKey: string;
  title: string; aliases: string[]; workspaceKind: WorkspaceKind; workspaceRoot: string;
  executionCwd: string; isolationMode: IsolationMode; sessionEpoch: string; threadId?: string;
  activeTurnId?: string; status: TaskStatus; objectiveSummary: string; recentRequests: string[];
  createdAt: string; updatedAt: string; lastActiveAt: string; lastRun?: LastRunSummary;
}

export interface ConversationTaskState {
  taskIds: string[]; lastTaskId?: string; lastProjects?: ProjectSelection[]; lastThreads?: ThreadSelection[];
  lastArchivedThreads?: ThreadSelection[]; lastTurns?: TurnSelection[];
}

/**
 * Creates an opaque, non-sensitive identity for one logical chat session.
 * Runtime app-server handles and permission grants must never be persisted here.
 */
export const createSessionEpoch = (): string => randomUUID();

export interface ProjectSelection {
  cwd: string;
  threadCount: number;
  updatedAt?: string;
  title?: string;
  preview?: string;
  latestThreadId?: string;
}

export interface ThreadSelection {
  threadId: string;
  cwd: string;
  title?: string;
  preview?: string;
  updatedAt?: string;
  resumable?: boolean;
  unavailableReason?: string;
}

export interface TurnSelection {
  threadId: string;
  turnId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
}

export interface PendingForkAttempt {
  sourceThreadId: string;
  lastTurnId?: string;
  startedAt: string;
  result?: ThreadSelection;
  selectionPersisted?: boolean;
}

export interface PendingThreadArchiveAttempt {
  action: "archive" | "unarchive";
  threadId: string;
  startedAt: string;
  completed?: boolean;
}

export type LastRunStatus = "success" | "failed" | "stopped";

export interface LastRunCommandSummary {
  command: string;
  cwd?: string;
  status?: string;
  exitCode?: number | null;
  durationMs?: number;
  outputPreview?: string;
}

export interface LastRunReviewSummary {
  changedFiles: string[];
  diff?: string;
  diffStat?: string;
  fileChangeCount: number;
  commands: LastRunCommandSummary[];
}

export interface LastRunSummary {
  id: string;
  status: LastRunStatus;
  cwd: string;
  threadId?: string;
  promptPreview: string;
  startedAt: string;
  completedAt: string;
  durationMs?: number;
  finalTextPreview?: string;
  errorPreview?: string;
  tokenUsage?: LastRunTokenUsage;
  review: LastRunReviewSummary;
}

export interface LastRunTokenUsageBreakdown {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface LastRunTokenUsage {
  last: LastRunTokenUsageBreakdown;
  total: LastRunTokenUsageBreakdown;
  modelContextWindow?: number | null;
}

export type EventDiagnosticOutcome = "routed" | "dropped";

export interface EventDiagnosticSnapshot {
  at: string;
  outcome: EventDiagnosticOutcome;
  reason?: string;
  messageId?: string;
  chatId?: string;
  chatType?: string;
  messageType?: string;
  mentionCount: number;
  startsWithMention: boolean;
  attachmentCount: number;
  textLength: number;
  botIdentityResolved: boolean;
}

export interface ChatDiagnostics {
  lastEvent?: EventDiagnosticSnapshot;
  lastDroppedEvent?: EventDiagnosticSnapshot;
  recentFailures?: RecentFailureDiagnostic[];
}

export interface BridgeDiagnostics extends ChatDiagnostics {
  byChat?: Record<string, ChatDiagnostics>;
}

export type FailureDiagnosticCategory =
  | "codex_missing"
  | "cwd_missing"
  | "app_server_timeout"
  | "approval_timeout"
  | "run_timeout"
  | "thread_unavailable"
  | "attachment_download_failed"
  | "unknown";

export interface RecentFailureDiagnostic {
  at: string;
  category: FailureDiagnosticCategory;
  cwd?: string;
  promptPreview?: string;
  threadId?: string;
  exitCode?: number | null;
  signal?: string | null;
  detail: string;
  hint?: string;
}

export type PendingMessageRoute =
  | "codex"
  | "control_replay_safe"
  | "control_no_replay"
  | "message";

export interface PendingMessageDelivery {
  messageId: string;
  chatId: string;
  chatType: "direct" | "group";
  sender: {
    openId?: string;
    userId?: string;
    unionId?: string;
  };
  text: string;
  naturalRouting?: "bypass";
  attachments?: Array<{
    kind: "image" | "file";
    key: string;
    name?: string;
    mediaType?: string;
    size?: number;
  }>;
  acceptedAt: string;
  attempts: number;
  lastError?: string;
  /**
   * Added after the initial durable-inbox rollout. Missing values are
   * classified conservatively during recovery for state-file compatibility.
   */
  route?: PendingMessageRoute;
  forkAttempt?: PendingForkAttempt;
  threadArchiveAttempt?: PendingThreadArchiveAttempt;
}

export type DurableCodexJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface DurableCodexJob {
  id: string;
  kind: "codex_run" | "control_recovery";
  messageId: string;
  chatId: string;
  chatType: "direct" | "group";
  cwd: string;
  prompt: string;
  localImages?: string[];
  /** Missing on pre-v0.5 state files and therefore treated as default mode. */
  collaborationMode?: "default" | "plan";
  threadId?: string;
  status: DurableCodexJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: LastRunSummary;
  deliveryIds: string[];
  taskId?: string; workspaceRoot?: string; executionCwd?: string; isolationMode?: IsolationMode;
  interruptionReason?: string;
  /** A durable singleton used to suppress repeated queue-full replies. */
  capacityNoticeScope?: "global" | "chat";
  capacityNoticeKind?: "durable" | "inbox";
  capacityNoticeActive?: boolean;
}

export type DurableOutboxStatus = "pending" | "sending" | "delivered";

interface DurableOutboxBase {
  id: string;
  jobId: string;
  /** Stable owner used to prevent cross-task delivery/recovery mixups. */
  taskId?: string;
  chatId: string;
  sequence: number;
  status: DurableOutboxStatus;
  idempotencyKey: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  lastError?: string;
}

export interface DurableTextOutboxMessage extends DurableOutboxBase {
  kind: "text" | "markdown";
  text: string;
}

export interface DurableMediaOutboxMessage extends DurableOutboxBase {
  taskId: string;
  kind: "image" | "file";
  text: "";
  stagedPath: string;
  fileName: string;
  mediaType: string;
  size: number;
  sha256: string;
}

export type DurableOutboxMessage =
  | DurableTextOutboxMessage
  | DurableMediaOutboxMessage;

export interface StagedImage {
  sourceMessageId: string;
  path: string;
  sha256: string;
  mediaType: string;
  bytes: number;
}

export interface ImageDraft {
  chatId: string;
  senderKey: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  images: StagedImage[];
  totalBytes: number;
}

export interface PendingClarification {
  chatId: string;
  senderKey: string;
  question: string;
  originalText?: string;
  /** Present only for task-aware image clarification; never stores image descriptors or bytes. */
  draftKey?: string;
  candidateTaskIds?: string[];
  choices: string[];
  createdAt: string;
  expiresAt: string;
}

export type UsageAdvisorSignalCode =
  | "task_target_clarification"
  | "abandoned_image_draft"
  | "routing_correction"
  | "delivery_retry"
  | "ownership_conflict"
  | "recovery_action";

export interface UsageAdvisorAggregate {
  code: UsageAdvisorSignalCode;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  recentAt: string[];
}

export type UsageAdvisorProposalStatus =
  | "pending_review"
  | "approved_for_planning"
  | "rejected";

export interface UsageAdvisorProposalSections {
  observation: string;
  benefit: string;
  risks: string;
  scope: string;
  rollback: string;
  verification: string;
}

export interface UsageAdvisorProposal {
  id: string;
  signalCode: UsageAdvisorSignalCode;
  status: UsageAdvisorProposalStatus;
  createdAt: string;
  reviewedAt?: string;
  evidence: UsageAdvisorAggregate;
  sections: UsageAdvisorProposalSections;
}

export interface UsageAdvisorState {
  aggregates: Partial<Record<UsageAdvisorSignalCode, UsageAdvisorAggregate>>;
  proposals: Record<string, UsageAdvisorProposal>;
}

export const emptyUsageAdvisorState = (): UsageAdvisorState => ({
  aggregates: {},
  proposals: {},
});

export interface BridgeState {
  tasks: Record<string, RegisteredTask>;
  conversations: Record<string, ConversationTaskState>;
  chats: Record<string, ChatSession>;
  jobs: Record<string, DurableCodexJob>;
  outbox: Record<string, DurableOutboxMessage>;
  pendingMessages: Record<string, PendingMessageDelivery>;
  processedMessageIds: string[];
  diagnostics: BridgeDiagnostics;
  imageDrafts?: Record<string, ImageDraft>;
  clarifications?: Record<string, PendingClarification>;
}

export const bridgeStateSchemaVersion = 5 as const;

/** On-disk envelope. Each adapter receives an isolated v0.6-compatible state partition. */
export interface BridgeStateEnvelopeV5 {
  schemaVersion: typeof bridgeStateSchemaVersion;
  adapters: Record<string, BridgeState>;
}

export const emptyState = (): BridgeState => ({
  tasks: {},
  conversations: {},
  chats: {},
  jobs: {},
  outbox: {},
  pendingMessages: {},
  processedMessageIds: [],
  diagnostics: {},
  imageDrafts: {},
  clarifications: {},
});
