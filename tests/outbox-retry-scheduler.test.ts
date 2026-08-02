import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import type { CodexRunInput, CodexRunResult } from "../src/agent/codex-runner.js";
import { loadConfig } from "../src/config/env.js";
import { MessageRouter, type ChatSender, type CodexClient } from "../src/bot/message-router.js";
import { JsonStateStore } from "../src/state/store.js";
import type { BridgeState } from "../src/state/types.js";
import type { Logger } from "../src/util/logger.js";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

describe("event-driven durable outbox retry", () => {
  test("UsageAdvisor persistence failure cannot block a manually released retry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-outbox-event-"));
    let router: MessageRouter | undefined;
    try {
      const config = loadConfig({ FEISHU_APP_ID: "test", FEISHU_APP_SECRET: "test", CODEX_WORKDIR: root, BRIDGE_STATE_PATH: path.join(root, "state.json"), ATTACHMENT_DOWNLOAD_DIR: path.join(root, "attachments"), ALLOWED_USER_IDS: "user" });
      const store = new FailAdvisorStore(config.bridgeStatePath);
      const sender = new FailingDeliverySender();
      const scheduler = new ManualRetryScheduler();
      const codex = new OneRunCodex();
      router = new MessageRouter(config, store, sender, logger, codex, {
        scheduleOutboxRetry: (delayMs, callback) => scheduler.schedule(delayMs, callback),
      });
      await router.start();
      store.failAdvisorSaves = true;
      await router.accept({ messageId: "job", chatId: "chat", chatType: "direct", sender: { openId: "user" }, text: "run" });
      await scheduler.waitForCount(1);
      expect(scheduler.delays).toEqual([250]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      scheduler.release(0);
      await sender.waitForCount(2);
      await scheduler.waitForCount(2);
      expect(scheduler.delays).toEqual([250, 1000]);

      const state = await waitForPersistedRetry(store);
      expect(store.advisorSaveAttempts).toBeGreaterThanOrEqual(1);
      expect(state.usageAdvisor?.aggregates.delivery_retry).toBeUndefined();
      expect(state.outbox[Object.keys(state.outbox)[0]!]!).toMatchObject({ status: "pending", attempts: 2 });
      expect(codex.runs).toBe(1);
      await router.dispose(); router = undefined;
      expect(scheduler.cancelled).toBe(1);
    } finally { await router?.dispose(); await rm(root, { recursive: true, force: true }); }
  });
});

class FailAdvisorStore extends JsonStateStore {
  failAdvisorSaves = false;
  advisorSaveAttempts = 0;
  override async save(state: BridgeState): Promise<void> {
    if (this.failAdvisorSaves && Object.keys(state.usageAdvisor?.aggregates ?? {}).length > 0) { this.advisorSaveAttempts += 1; throw new Error("simulated advisor save failure"); }
    await super.save(state);
  }
}
class OneRunCodex implements CodexClient {
  runs = 0;
  async run(_input: CodexRunInput): Promise<CodexRunResult> { this.runs += 1; return { threadId: "thread", finalText: "done", stderr: "", exitCode: 0 }; }
}
class FailingDeliverySender implements ChatSender {
  private attempts = 0;
  private waiters: Array<{ count: number; resolve(): void }> = [];
  async sendText(_chatId: string, _text: string, options?: { idempotencyKey?: string }): Promise<void> { if (!options?.idempotencyKey) return; this.attempts += 1; this.flush(); throw new Error("simulated durable delivery failure"); }
  async sendMarkdown(chatId: string, text: string, options?: { idempotencyKey?: string }): Promise<void> { await this.sendText(chatId, text, options); }
  waitForCount(count: number): Promise<void> { if (this.attempts >= count) return Promise.resolve(); return new Promise((resolve) => this.waiters.push({ count, resolve })); }
  private flush(): void { for (const waiter of this.waiters.splice(0)) { if (this.attempts >= waiter.count) waiter.resolve(); else this.waiters.push(waiter); } }
}
class ManualRetryScheduler {
  readonly delays: number[] = [];
  cancelled = 0;
  private callbacks: Array<(() => void) | undefined> = [];
  private waiters: Array<{ count: number; resolve(): void }> = [];
  schedule(delayMs: number, callback: () => void): () => void { const index = this.callbacks.length; this.delays.push(delayMs); this.callbacks.push(callback); this.flush(); return () => { if (this.callbacks[index]) { this.callbacks[index] = undefined; this.cancelled += 1; } }; }
  release(index: number): void { const callback = this.callbacks[index]; if (!callback) throw new Error("Retry callback is unavailable."); this.callbacks[index] = undefined; callback(); }
  waitForCount(count: number): Promise<void> { if (this.delays.length >= count) return Promise.resolve(); return new Promise((resolve) => this.waiters.push({ count, resolve })); }
  private flush(): void { for (const waiter of this.waiters.splice(0)) { if (this.delays.length >= waiter.count) waiter.resolve(); else this.waiters.push(waiter); } }
}
async function waitForPersistedRetry(store: JsonStateStore): Promise<BridgeState> { for (let index = 0; index < 100; index += 1) { const state = await store.load(); const delivery = Object.values(state.outbox)[0]; if (delivery?.status === "pending" && delivery.attempts >= 2) return state; await Promise.resolve(); } throw new Error("Persisted retry did not converge after the explicit retry event."); }
