import { CodexRunner } from "../agent/codex-runner.js";
import { feishuInteractionPolicy } from "../adapters/feishu/interaction-policy.js";
import { textInteractionPolicy } from "../core/interaction-policy.js";
import type { BridgeConfig } from "../config/env.js";
import {
  MessageRouter as CoreMessageRouter,
  type ChatSender,
  type CodexClient,
  type MessageRouterRuntimeControl,
  type NaturalConversationDependencies,
} from "../core/message-router.js";
import type { JsonStateStore } from "../state/store.js";
import type { Logger } from "../util/logger.js";

export * from "../core/message-router.js";

/** @deprecated Import MessageRouter from core and inject an adapter interaction policy. */
export class MessageRouter extends CoreMessageRouter {
  constructor(
    config: BridgeConfig,
    store: JsonStateStore,
    sender: ChatSender,
    logger: Logger,
    codex?: CodexClient,
    runtimeControl: MessageRouterRuntimeControl = {},
    naturalConversation?: NaturalConversationDependencies,
  ) {
    super(
      config,
      store,
      sender,
      logger,
      codex ?? new CodexRunner(config, logger),
      config.chatAdapter === "weixin" ? textInteractionPolicy : feishuInteractionPolicy,
      runtimeControl,
      naturalConversation,
    );
  }
}
