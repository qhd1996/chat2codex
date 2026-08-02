import path from "node:path";

import { z } from "zod";

import { defaultChat2CodexHome } from "./paths.js";

export interface AccessControlConfig {
  allowDirectMessages: boolean;
  allowGroups: boolean;
  allowedChatIds: string[];
  allowedUserIds: string[];
}

const codexApprovalPolicies = ["untrusted", "on-request", "never"] as const;
const codexApprovalsReviewers = ["auto_review", "user"] as const;
export const configuredWorkspaceKinds = ["work", "travel", "personal", "finance", "ai_lab", "learning"] as const;
export type ConfiguredWorkspaceKind = typeof configuredWorkspaceKinds[number];

const ONE_GIBIBYTE = 1024 ** 3;
const ONE_TEBIBYTE = 1024 ** 4;

const positiveIntegerEnv = (defaultValue: number, maximum: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") {
      return defaultValue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return defaultValue;
      }
      if (!/^\d+$/.test(trimmed)) {
        return value;
      }
      return Number(trimmed);
    }
    return value;
  }, z.number().int().positive().max(maximum));

const timeoutEnv = (defaultValue = 0) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") {
      return defaultValue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return defaultValue;
      }
      return Number(trimmed);
    }
    return value;
  }, z.number().int().nonnegative());

const confidenceEnv = (defaultValue: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    return typeof value === "string" ? Number(value.trim()) : value;
  }, z.number().min(0).max(1));

const booleanEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") {
      return defaultValue;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "y", "on"].includes(normalized)) {
        return true;
      }
      if (["0", "false", "no", "n", "off"].includes(normalized)) {
        return false;
      }
    }
    return value;
  }, z.boolean());

const configSchema = z.object({
  CHAT2CODEX_ADAPTER: z.enum(["feishu", "weixin"]).default("feishu"),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  FEISHU_BOT_OPEN_ID: z.string().optional(),
  LARK_DOMAIN: z.enum(["feishu", "lark"]).default("feishu"),
  WEIXIN_CREDENTIALS_PATH: z.string().optional(),
  WEIXIN_NATURAL_ROUTING: booleanEnv(true),
  WEIXIN_INTENT_BASE_URL: z.string().url().default("http://127.0.0.1:23333/api/openai/v1"),
  WEIXIN_INTENT_MODEL: z.string().min(1).default("gpt-5.6-sol"),
  WEIXIN_INTENT_TIMEOUT_MS: positiveIntegerEnv(8_000, 120_000),
  WEIXIN_INTENT_MIN_CONFIDENCE: confidenceEnv(0.78),
  WEIXIN_IMAGE_DRAFT_TTL_MS: positiveIntegerEnv(30 * 60_000, 24 * 60 * 60_000),
  WEIXIN_IMAGE_DRAFT_MAX_COUNT: positiveIntegerEnv(4, 32),
  WEIXIN_IMAGE_DRAFT_MAX_FILE_BYTES: positiveIntegerEnv(25 * 1024 ** 2, ONE_TEBIBYTE),
  WEIXIN_IMAGE_DRAFT_MAX_TOTAL_BYTES: positiveIntegerEnv(50 * 1024 ** 2, ONE_TEBIBYTE),
  CODEX_BIN: z.string().min(1).default("codex"),
  CODEX_WORKDIR: z.string().min(1).default(process.cwd()),
  CODEX_SANDBOX: z.enum(["read-only", "workspace-write", "danger-full-access"]).default("workspace-write"),
  CODEX_APPROVAL_POLICY: z.enum(codexApprovalPolicies).default("never"),
  CODEX_APPROVALS_REVIEWER: z.enum(codexApprovalsReviewers).default("auto_review"),
  CODEX_RUN_TIMEOUT_MS: timeoutEnv().default(0),
  CODEX_APPROVAL_TIMEOUT_MS: timeoutEnv().default(0),
  CODEX_MAX_CONCURRENT_RUNS: positiveIntegerEnv(2, 256),
  CODEX_APP_SERVER_IDLE_TTL_MS: timeoutEnv(900_000).default(900_000),
  CODEX_MAX_APP_SERVER_SESSIONS: positiveIntegerEnv(8, 256),
  CODEX_MODEL: z.string().optional(),
  CODEX_SKIP_GIT_REPO_CHECK: booleanEnv(false),
  CODEX_GROUP_ALLOWED_ROOTS: z.string().default(""),
  CHAT2CODEX_WORKSPACE_ROUTES: z.string().default(""),
  ALLOW_DIRECT_MESSAGES: booleanEnv(true),
  ALLOW_GROUPS: booleanEnv(false),
  ALLOWED_CHAT_IDS: z.string().default(""),
  ALLOWED_USER_IDS: z.string().default(""),
  BRIDGE_MAX_PENDING_MESSAGES: positiveIntegerEnv(64, 100_000),
  BRIDGE_MAX_PENDING_MESSAGES_PER_CHAT: positiveIntegerEnv(8, 100_000),
  ATTACHMENT_DOWNLOAD_DIR: z.string().min(1).default(".data/attachments"),
  ATTACHMENT_MAX_COUNT: positiveIntegerEnv(4, 1_000),
  ATTACHMENT_MAX_FILE_BYTES: positiveIntegerEnv(25 * 1024 ** 2, ONE_TEBIBYTE),
  ATTACHMENT_MAX_TOTAL_BYTES: positiveIntegerEnv(50 * 1024 ** 2, ONE_TEBIBYTE),
  ATTACHMENT_STORE_MAX_BYTES: positiveIntegerEnv(ONE_GIBIBYTE, ONE_TEBIBYTE),
  ATTACHMENT_RETENTION_HOURS: positiveIntegerEnv(24, 24 * 365 * 10),
  OUTBOUND_MEDIA_MAX_COUNT: positiveIntegerEnv(16, 16),
  OUTBOUND_MEDIA_MAX_FILE_BYTES: positiveIntegerEnv(25 * 1024 ** 2, ONE_TEBIBYTE),
  OUTBOUND_MEDIA_MAX_TOTAL_BYTES: positiveIntegerEnv(50 * 1024 ** 2, ONE_TEBIBYTE),
  OUTBOUND_MEDIA_RETENTION_HOURS: positiveIntegerEnv(24, 24 * 365 * 10),
  CHAT_OUTPUT_MAX_CHARS: positiveIntegerEnv(28_000, ONE_GIBIBYTE),
  CODEX_STDERR_MAX_BYTES: positiveIntegerEnv(256 * 1024, ONE_GIBIBYTE),
  RUN_LOG_MAX_COMMANDS: positiveIntegerEnv(20, 100_000),
  RUN_LOG_MAX_BYTES: positiveIntegerEnv(64 * 1024, ONE_GIBIBYTE),
  RUN_DIFF_MAX_CHARS: positiveIntegerEnv(60_000, ONE_GIBIBYTE),
  LOG_ENTRY_MAX_BYTES: positiveIntegerEnv(16 * 1024, ONE_GIBIBYTE),
  LOG_FILE_MAX_BYTES: positiveIntegerEnv(10 * 1024 ** 2, ONE_TEBIBYTE),
  LOG_FILE_MAX_FILES: positiveIntegerEnv(3, 10_000),
  JOB_RETENTION_COUNT: positiveIntegerEnv(500, 1_000_000),
  OUTBOX_RETENTION_COUNT: positiveIntegerEnv(500, 1_000_000),
  BRIDGE_STATE_PATH: z.string().min(1).default(".data/state.json"),
  CHAT2CODEX_LOG_FILE: z.string().optional(),
  CHAT2CODEX_SERVICE_RESTART_ENABLED: booleanEnv(false),
  CHAT2CODEX_DESKTOP_GATEWAY_ENABLED: booleanEnv(false),
  CHAT2CODEX_DESKTOP_GATEWAY_PORT: positiveIntegerEnv(43_127, 65_535),
  CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE: z.string().optional(),
  CHAT2CODEX_DESKTOP_STOP_TOKEN_FILE: z.string().optional(),
  CHAT2CODEX_DESKTOP_MCP_TOKEN_FILE: z.string().optional(),
  CHAT2CODEX_DESKTOP_PROMPT_TOKEN: z.string().optional(),
  CHAT2CODEX_DESKTOP_STOP_TOKEN: z.string().optional(),
  CHAT2CODEX_DESKTOP_MCP_TOKEN: z.string().optional(),
  CHAT2CODEX_DESKTOP_GATEWAY_MAX_BODY_BYTES: positiveIntegerEnv(64 * 1024, 1024 * 1024),
  CHAT2CODEX_DESKTOP_GATEWAY_MAX_CONCURRENCY: positiveIntegerEnv(16, 256),
  CHAT2CODEX_DESKTOP_GATEWAY_DEADLINE_MS: positiveIntegerEnv(2_000, 30_000),
  CHAT2CODEX_DESKTOP_HEARTBEAT_MS: positiveIntegerEnv(10_000, 10 * 60_000),
  CHAT2CODEX_DESKTOP_LEASE_MS: positiveIntegerEnv(30_000, 60 * 60_000),
  CHAT2CODEX_DESKTOP_RECONCILE_MS: positiveIntegerEnv(15_000, 60 * 60_000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
}).superRefine((config, context) => {
  if (config.CHAT2CODEX_DESKTOP_PROMPT_TOKEN || config.CHAT2CODEX_DESKTOP_STOP_TOKEN || config.CHAT2CODEX_DESKTOP_MCP_TOKEN) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["CHAT2CODEX_DESKTOP_GATEWAY_ENABLED"], message: "raw Desktop Gateway token values are forbidden; use owner-only token files" });
  }
  if (config.CHAT2CODEX_DESKTOP_HEARTBEAT_MS >= config.CHAT2CODEX_DESKTOP_LEASE_MS) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["CHAT2CODEX_DESKTOP_HEARTBEAT_MS"], message: "heartbeat must be shorter than the Desktop lease" });
  }
  if (config.CHAT2CODEX_ADAPTER === "feishu") {
    if (!config.FEISHU_APP_ID?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FEISHU_APP_ID"],
        message: "is required when CHAT2CODEX_ADAPTER=feishu",
      });
    }
    if (!config.FEISHU_APP_SECRET?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FEISHU_APP_SECRET"],
        message: "is required when CHAT2CODEX_ADAPTER=feishu",
      });
    }
  }
  if (config.BRIDGE_MAX_PENDING_MESSAGES_PER_CHAT > config.BRIDGE_MAX_PENDING_MESSAGES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BRIDGE_MAX_PENDING_MESSAGES_PER_CHAT"],
      message: "must not exceed BRIDGE_MAX_PENDING_MESSAGES",
    });
  }
  if (config.CODEX_MAX_APP_SERVER_SESSIONS < config.CODEX_MAX_CONCURRENT_RUNS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CODEX_MAX_APP_SERVER_SESSIONS"],
      message: "must be greater than or equal to CODEX_MAX_CONCURRENT_RUNS",
    });
  }
  if (config.ATTACHMENT_MAX_FILE_BYTES > config.ATTACHMENT_MAX_TOTAL_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ATTACHMENT_MAX_FILE_BYTES"],
      message: "must not exceed ATTACHMENT_MAX_TOTAL_BYTES",
    });
  }
  if (config.WEIXIN_IMAGE_DRAFT_MAX_FILE_BYTES > config.WEIXIN_IMAGE_DRAFT_MAX_TOTAL_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WEIXIN_IMAGE_DRAFT_MAX_FILE_BYTES"],
      message: "must not exceed WEIXIN_IMAGE_DRAFT_MAX_TOTAL_BYTES",
    });
  }
  if (config.OUTBOUND_MEDIA_MAX_FILE_BYTES > config.OUTBOUND_MEDIA_MAX_TOTAL_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OUTBOUND_MEDIA_MAX_FILE_BYTES"],
      message: "must not exceed OUTBOUND_MEDIA_MAX_TOTAL_BYTES",
    });
  }
  if (config.ATTACHMENT_MAX_TOTAL_BYTES > config.ATTACHMENT_STORE_MAX_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ATTACHMENT_MAX_TOTAL_BYTES"],
      message: "must not exceed ATTACHMENT_STORE_MAX_BYTES",
    });
  }
  if (config.LOG_ENTRY_MAX_BYTES > config.LOG_FILE_MAX_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LOG_ENTRY_MAX_BYTES"],
      message: "must not exceed LOG_FILE_MAX_BYTES",
    });
  }
});

export type BridgeConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv) {
  const parsed = configSchema.parse(env);
  const home = defaultChat2CodexHome(env);
  const codexWorkdir = path.resolve(parsed.CODEX_WORKDIR);
  const groupAllowedRoots = parseCsv(parsed.CODEX_GROUP_ALLOWED_ROOTS).map((entry) =>
    path.resolve(entry),
  );
  const workspaceRoutes = parseWorkspaceRoutes(parsed.CHAT2CODEX_WORKSPACE_ROUTES, codexWorkdir);
  const gatewayTokenFiles = {
    promptHook: path.resolve(parsed.CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE?.trim() || path.join(home, "desktop-gateway", "prompt-hook.key")),
    stopHook: path.resolve(parsed.CHAT2CODEX_DESKTOP_STOP_TOKEN_FILE?.trim() || path.join(home, "desktop-gateway", "stop-hook.key")),
    desktopMcp: path.resolve(parsed.CHAT2CODEX_DESKTOP_MCP_TOKEN_FILE?.trim() || path.join(home, "desktop-gateway", "desktop-mcp.key")),
  };
  if (parsed.CHAT2CODEX_DESKTOP_GATEWAY_ENABLED) {
    for (const [name, raw] of [["prompt", parsed.CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE], ["stop", parsed.CHAT2CODEX_DESKTOP_STOP_TOKEN_FILE], ["MCP", parsed.CHAT2CODEX_DESKTOP_MCP_TOKEN_FILE]] as const) {
      if (raw?.trim() && !path.isAbsolute(raw.trim())) throw new Error(`Desktop Gateway ${name} token path must be absolute.`);
    }
    const normalized = Object.values(gatewayTokenFiles).map((value) => process.platform === "win32" ? value.toLowerCase() : value);
    if (new Set(normalized).size !== normalized.length) throw new Error("Desktop Gateway token paths must be distinct.");
  }
  return {
    chat2codexHome: home,
    chatAdapter: parsed.CHAT2CODEX_ADAPTER,
    feishuAppId: parsed.FEISHU_APP_ID?.trim() ?? "",
    feishuAppSecret: parsed.FEISHU_APP_SECRET?.trim() ?? "",
    feishuBotOpenId: parsed.FEISHU_BOT_OPEN_ID?.trim() || undefined,
    larkDomain: parsed.LARK_DOMAIN,
    weixinCredentialsPath: path.resolve(
      parsed.WEIXIN_CREDENTIALS_PATH?.trim() ||
        path.join(home, "weixin", "credentials.json"),
    ),
    weixinNaturalRouting: parsed.WEIXIN_NATURAL_ROUTING,
    weixinIntentBaseUrl: parsed.WEIXIN_INTENT_BASE_URL.replace(/\/+$/u, ""),
    weixinIntentModel: parsed.WEIXIN_INTENT_MODEL.trim(),
    weixinIntentTimeoutMs: parsed.WEIXIN_INTENT_TIMEOUT_MS,
    weixinIntentMinConfidence: parsed.WEIXIN_INTENT_MIN_CONFIDENCE,
    weixinImageDraftTtlMs: parsed.WEIXIN_IMAGE_DRAFT_TTL_MS,
    weixinImageDraftMaxCount: parsed.WEIXIN_IMAGE_DRAFT_MAX_COUNT,
    weixinImageDraftMaxFileBytes: parsed.WEIXIN_IMAGE_DRAFT_MAX_FILE_BYTES,
    weixinImageDraftMaxTotalBytes: parsed.WEIXIN_IMAGE_DRAFT_MAX_TOTAL_BYTES,
    codexBin: parsed.CODEX_BIN,
    codexWorkdir,
    codexSandbox: parsed.CODEX_SANDBOX,
    codexApprovalPolicy: parsed.CODEX_APPROVAL_POLICY,
    codexApprovalsReviewer: parsed.CODEX_APPROVALS_REVIEWER,
    codexRunTimeoutMs: parsed.CODEX_RUN_TIMEOUT_MS,
    codexApprovalTimeoutMs: parsed.CODEX_APPROVAL_TIMEOUT_MS,
    codexMaxConcurrentRuns: parsed.CODEX_MAX_CONCURRENT_RUNS,
    codexAppServerIdleTtlMs: parsed.CODEX_APP_SERVER_IDLE_TTL_MS,
    codexMaxAppServerSessions: parsed.CODEX_MAX_APP_SERVER_SESSIONS,
    codexModel: parsed.CODEX_MODEL?.trim() || undefined,
    codexSkipGitRepoCheck: parsed.CODEX_SKIP_GIT_REPO_CHECK,
    codexGroupAllowedRoots: groupAllowedRoots.length > 0 ? groupAllowedRoots : [codexWorkdir],
    workspaceRoutes,
    access: {
      allowDirectMessages: parsed.ALLOW_DIRECT_MESSAGES,
      allowGroups: parsed.ALLOW_GROUPS,
      allowedChatIds: parseCsv(parsed.ALLOWED_CHAT_IDS),
      allowedUserIds: parseCsv(parsed.ALLOWED_USER_IDS),
    } satisfies AccessControlConfig,
    bridgeMaxPendingMessages: parsed.BRIDGE_MAX_PENDING_MESSAGES,
    bridgeMaxPendingMessagesPerChat: parsed.BRIDGE_MAX_PENDING_MESSAGES_PER_CHAT,
    attachmentDownloadDir: path.resolve(
      env.ATTACHMENT_DOWNLOAD_DIR || path.join(home, "attachments"),
    ),
    attachmentMaxCount: parsed.ATTACHMENT_MAX_COUNT,
    attachmentMaxFileBytes: parsed.ATTACHMENT_MAX_FILE_BYTES,
    attachmentMaxTotalBytes: parsed.ATTACHMENT_MAX_TOTAL_BYTES,
    attachmentStoreMaxBytes: parsed.ATTACHMENT_STORE_MAX_BYTES,
    attachmentRetentionHours: parsed.ATTACHMENT_RETENTION_HOURS,
    outboundMediaMaxCount: parsed.OUTBOUND_MEDIA_MAX_COUNT,
    outboundMediaMaxFileBytes: parsed.OUTBOUND_MEDIA_MAX_FILE_BYTES,
    outboundMediaMaxTotalBytes: parsed.OUTBOUND_MEDIA_MAX_TOTAL_BYTES,
    outboundMediaRetentionHours: parsed.OUTBOUND_MEDIA_RETENTION_HOURS,
    chatOutputMaxChars: parsed.CHAT_OUTPUT_MAX_CHARS,
    codexStderrMaxBytes: parsed.CODEX_STDERR_MAX_BYTES,
    runLogMaxCommands: parsed.RUN_LOG_MAX_COMMANDS,
    runLogMaxBytes: parsed.RUN_LOG_MAX_BYTES,
    runDiffMaxChars: parsed.RUN_DIFF_MAX_CHARS,
    logEntryMaxBytes: parsed.LOG_ENTRY_MAX_BYTES,
    logFileMaxBytes: parsed.LOG_FILE_MAX_BYTES,
    logFileMaxFiles: parsed.LOG_FILE_MAX_FILES,
    jobRetentionCount: parsed.JOB_RETENTION_COUNT,
    outboxRetentionCount: parsed.OUTBOX_RETENTION_COUNT,
    bridgeStatePath: path.resolve(env.BRIDGE_STATE_PATH || path.join(home, "state.json")),
    logFilePath: parsed.CHAT2CODEX_LOG_FILE?.trim()
      ? path.resolve(parsed.CHAT2CODEX_LOG_FILE)
      : undefined,
    serviceRestartEnabled: parsed.CHAT2CODEX_SERVICE_RESTART_ENABLED,
    desktopGateway: {
      enabled: parsed.CHAT2CODEX_DESKTOP_GATEWAY_ENABLED,
      port: parsed.CHAT2CODEX_DESKTOP_GATEWAY_PORT,
      expectedHost: `127.0.0.1:${parsed.CHAT2CODEX_DESKTOP_GATEWAY_PORT}`,
      tokenFiles: gatewayTokenFiles,
      maxBodyBytes: parsed.CHAT2CODEX_DESKTOP_GATEWAY_MAX_BODY_BYTES,
      maxConcurrency: parsed.CHAT2CODEX_DESKTOP_GATEWAY_MAX_CONCURRENCY,
      deadlineMs: parsed.CHAT2CODEX_DESKTOP_GATEWAY_DEADLINE_MS,
      heartbeatMs: parsed.CHAT2CODEX_DESKTOP_HEARTBEAT_MS,
      leaseMs: parsed.CHAT2CODEX_DESKTOP_LEASE_MS,
      reconcileMs: parsed.CHAT2CODEX_DESKTOP_RECONCILE_MS,
    },
    logLevel: parsed.LOG_LEVEL,
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseWorkspaceRoutes(value: string, codexWorkdir: string): Record<string, string> {
  if (!value.trim()) return { work: codexWorkdir };
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { throw new Error("CHAT2CODEX_WORKSPACE_ROUTES must be valid JSON."); }
  const schema = z.object(Object.fromEntries(configuredWorkspaceKinds.map((kind) => [kind, z.string().min(1)])) as Record<ConfiguredWorkspaceKind, z.ZodString>).strict();
  const parsed = schema.parse(raw) as Record<ConfiguredWorkspaceKind, string>;
  const resolved = Object.fromEntries(configuredWorkspaceKinds.map((kind) => [kind, path.resolve(parsed[kind])]));
  const normalized = Object.values(resolved).map((root) => process.platform === "win32" ? root.toLocaleLowerCase() : root);
  if (new Set(normalized).size !== normalized.length) throw new Error("CHAT2CODEX_WORKSPACE_ROUTES contains duplicate paths.");
  return resolved;
}
