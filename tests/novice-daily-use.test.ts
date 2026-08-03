import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { runNoviceDailyUseJourney } from "../src/quality/novice-product-driver.js";

describe("novice daily-use product journey", () => {
  test("contains workspace routes when the supplied root resolves through a Windows junction", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-root-alias-"));
    const target = path.join(parent, "target");
    const alias = path.join(parent, "alias");
    try {
      await mkdir(target);
      await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
      const result = await runNoviceDailyUseJourney({ root: alias });
      expect(result.workspaceContained).toBe(true);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  test("creates, continues, stops, and retries two exact tasks across all workspace routes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-daily-"));
    try {
      const result = await runNoviceDailyUseJourney({ root });
      expect(result.taskIds).toHaveLength(2);
      expect(new Set(result.taskIds).size).toBe(2);
      expect(result.taskStatuses).toEqual(["running", "running"]);
      expect(new Set(result.recentRequests)).toEqual(new Set(["continue the exact task", "retry the exact task"]));
      expect(result.recentRequests).toHaveLength(4);
      expect(result.workspaceKinds).toEqual(["work", "travel", "personal", "finance", "ai_lab", "learning"]);
      expect(result.workspaceContained).toBe(true);
      expect(result.planMode).toBe("plan");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("uses the real interaction policy and ordered media outbox through mock transport", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-media-"));
    try {
      const result = await runNoviceDailyUseJourney({ root });
      expect(result.approvalAllowed).toBe(true);
      expect(result.permissionAllowed).toBe(true);
      expect(result.structuredValue).toBe("conservative");
      expect(result.outboxKinds).toEqual(["markdown", "image", "file"]);
      expect(result.outboxSequences).toEqual([0, 1, 2]);
      expect(result.deliveredIds).toHaveLength(3);
      expect(result.duplicateAcknowledgements).toBe(3);
      expect(new Set(result.deliveredIds).size).toBe(3);
      expect(result.codexRuns).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
