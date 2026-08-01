import { describe, expect, test } from "bun:test";

import type { ActionResponse, OutboundMediaInput } from "../src/core/actions.js";
import type {
  AdapterEventHandler,
  AttachmentRef,
  AttachmentStream,
  ChatAdapter,
  DeliveryOptions,
  DeliveryResult,
  InboundEvent,
  MessageReaction,
  MessageReactionHandle,
  MessageReactionRemovalResult,
  MessageReactionResult,
  MessageRef,
  ViewHandle,
  ViewTarget,
} from "../src/core/contracts.js";
import type { ChatView } from "../src/core/view-models.js";
import { AdapterSupervisor } from "../src/runtime/adapter-supervisor.js";

class ContractAdapter implements ChatAdapter {
  readonly descriptor;
  readonly capabilities = {
    markdown: true,
    interactiveViews: true,
    viewUpdates: true,
    attachments: true,
    messageReactions: true,
  };
  handler?: AdapterEventHandler;
  startError?: Error;
  stopCount = 0;
  deliveries: Array<{ target: ViewTarget; view: ChatView; options?: DeliveryOptions }> = [];
  reactions: Array<{ ref: MessageRef; reaction: MessageReaction }> = [];
  removedReactions: MessageReactionHandle[] = [];

  constructor(adapterId: string) {
    const [platformKind = "test", accountId = "default"] = adapterId.split(":");
    this.descriptor = { adapterId, platformKind, accountId };
  }

  async start(handler: AdapterEventHandler): Promise<void> {
    if (this.startError) {
      throw this.startError;
    }
    this.handler = handler;
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
  }

  async sendView(
    target: ViewTarget,
    view: ChatView,
    options?: DeliveryOptions,
  ): Promise<DeliveryResult> {
    this.deliveries.push({ target, view, options });
    return {
      status: "delivered",
      handle: { ...target, messageId: `message-${this.deliveries.length}` },
    };
  }

  async updateView(_handle: ViewHandle, _view: ChatView): Promise<DeliveryResult> {
    return { status: "delivered" };
  }

  async addReaction(
    ref: MessageRef,
    reaction: MessageReaction,
  ): Promise<MessageReactionResult> {
    this.reactions.push({ ref, reaction });
    return {
      status: "delivered",
      handle: {
        ...ref,
        reaction,
        reactionId: `reaction-${this.reactions.length}`,
      },
    };
  }

  async removeReaction(
    handle: MessageReactionHandle,
  ): Promise<MessageReactionRemovalResult> {
    this.removedReactions.push(handle);
    return { status: "delivered" };
  }

  async openAttachment(_ref: AttachmentRef): Promise<AttachmentStream> {
    return {
      chunks: (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
    };
  }

  emit(event: InboundEvent): Promise<ActionResponse | void> {
    if (!this.handler) {
      throw new Error("adapter is not started");
    }
    return this.handler(event);
  }
}

class MediaContractAdapter extends ContractAdapter {
  mediaDeliveries: Array<{
    target: ViewTarget;
    input: OutboundMediaInput;
    options?: DeliveryOptions;
  }> = [];

  async sendMedia(
    target: ViewTarget,
    input: OutboundMediaInput,
    options?: DeliveryOptions,
  ): Promise<DeliveryResult> {
    this.mediaDeliveries.push({ target, input, options });
    return { status: "delivered" };
  }
}

describe("AdapterSupervisor", () => {
  test("rejects duplicate adapter ids before any platform starts", () => {
    expect(() => new AdapterSupervisor([
      new ContractAdapter("feishu:default"),
      new ContractAdapter("feishu:default"),
    ])).toThrow("Duplicate chat adapter id");
  });

  test("keeps ready adapters running when another adapter fails to start", async () => {
    const feishu = new ContractAdapter("feishu:default");
    const broken = new ContractAdapter("slack:broken");
    broken.startError = new Error("simulated connection failure");
    const supervisor = new AdapterSupervisor([feishu, broken]);
    await supervisor.start(async () => undefined);

    expect(supervisor.listStatuses()).toEqual([
      expect.objectContaining({ adapterId: "feishu:default", health: "ready" }),
      expect.objectContaining({ adapterId: "slack:broken", health: "degraded" }),
    ]);
    await supervisor.sendView(
      { adapterId: "feishu:default", conversationId: "chat" },
      { kind: "text", text: "hello" },
    );
    expect(feishu.deliveries).toHaveLength(1);
    await supervisor.stop();
  });

  test("fails startup when no configured adapter becomes ready", async () => {
    const broken = new ContractAdapter("feishu:default");
    broken.startError = new Error("offline");
    const supervisor = new AdapterSupervisor([broken]);
    await expect(supervisor.start(async () => undefined)).rejects.toThrow(
      "No chat adapter started successfully",
    );
    await supervisor.stop();
  });

  test("routes events and deliveries strictly by adapter id", async () => {
    const feishu = new ContractAdapter("feishu:default");
    const slack = new ContractAdapter("slack:team-a");
    const observed: InboundEvent[] = [];
    const supervisor = new AdapterSupervisor([feishu, slack]);
    await supervisor.start(async (event) => {
      observed.push(event);
      return { kind: "toast", level: "success", text: "ok" };
    });

    const response = await slack.emit({
      kind: "diagnostic",
      adapterId: "slack:team-a",
      outcome: "routed",
      mentionCount: 0,
      attachmentCount: 0,
      textLength: 4,
      botIdentityResolved: true,
    });
    expect(response).toEqual({ kind: "toast", level: "success", text: "ok" });
    expect(observed).toHaveLength(1);

    await supervisor.sendView(
      { adapterId: "slack:team-a", conversationId: "same-chat" },
      { kind: "text", text: "slack only" },
    );
    expect(slack.deliveries).toHaveLength(1);
    expect(feishu.deliveries).toHaveLength(0);

    const reaction = await supervisor.addReaction(
      {
        adapterId: "slack:team-a",
        conversationId: "same-chat",
        messageId: "source-message",
      },
      "processing",
    );
    expect(reaction).toMatchObject({
      status: "delivered",
      handle: {
        adapterId: "slack:team-a",
        conversationId: "same-chat",
        messageId: "source-message",
        reaction: "processing",
      },
    });
    if (reaction.status === "delivered") {
      await supervisor.removeReaction(reaction.handle);
    }
    expect(slack.reactions).toHaveLength(1);
    expect(slack.removedReactions).toHaveLength(1);
    expect(feishu.reactions).toHaveLength(0);

    await expect(slack.emit({
      kind: "diagnostic",
      adapterId: "feishu:default",
      outcome: "routed",
      mentionCount: 0,
      attachmentCount: 0,
      textLength: 0,
      botIdentityResolved: true,
    })).rejects.toThrow("emitted an event scoped to");
    await supervisor.stop();
  });

  test("media sender preserves adapter isolation and an immutable idempotent contract", async () => {
    const feishu = new MediaContractAdapter("feishu:default");
    const weixin = new MediaContractAdapter("weixin:clawbot");
    const supervisor = new AdapterSupervisor([feishu, weixin]);
    await supervisor.start(async () => undefined);
    const input: OutboundMediaInput = {
      kind: "image",
      stagedPath: "C:\\private\\outbound\\task\\job\\01-answer.png",
      fileName: "answer.png",
      mediaType: "image/png",
      size: 123,
      sha256: "a".repeat(64),
    };

    const result = await supervisor.sendMedia(
      { adapterId: "weixin:clawbot", conversationId: "same-chat" },
      input,
      { idempotencyKey: "job-7:1" },
    );

    expect(result).toEqual({ status: "delivered" });
    expect(feishu.mediaDeliveries).toHaveLength(0);
    expect(weixin.mediaDeliveries).toEqual([{
      target: { adapterId: "weixin:clawbot", conversationId: "same-chat" },
      input,
      options: { idempotencyKey: "job-7:1" },
    }]);
    expect(Object.isFrozen(weixin.mediaDeliveries[0]!.input)).toBe(true);
    await supervisor.stop();
  });

  test("media sender fails closed when the owning adapter has no media transport", async () => {
    const unsupported = new ContractAdapter("feishu:default");
    const supervisor = new AdapterSupervisor([unsupported]);
    await supervisor.start(async () => undefined);

    const result = await supervisor.sendMedia(
      { adapterId: "feishu:default", conversationId: "chat" },
      {
        kind: "file",
        stagedPath: "C:\\private\\outbound\\task\\job\\01-report.pdf",
        fileName: "report.pdf",
        mediaType: "application/pdf",
        size: 456,
        sha256: "b".repeat(64),
      },
      { idempotencyKey: "job-8:0" },
    );

    expect(result).toEqual({
      status: "unsupported",
      reason: "Adapter feishu:default does not support outbound media.",
    });
    expect(unsupported.deliveries).toHaveLength(0);
    await supervisor.stop();
  });
});
