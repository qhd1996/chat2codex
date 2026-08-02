import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { runV5UpgradeRollbackJourney } from "../src/quality/novice-product-driver.js";

describe("existing novice upgrade and rollback journey", () => {
  test("migrates tasks and delivered/pending outbox to v6 with an exact v5 backup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-upgrade-"));
    try {
      const result = await runV5UpgradeRollbackJourney({ root });
      expect(result.sourceSchema).toBe(5);
      expect(result.migratedSchema).toBe(6);
      expect(result.sourceHash).toBe(result.backupHash);
      expect(result.taskIdsAfter).toEqual(result.taskIdsBefore);
      expect(result.outboxAfter).toEqual(result.outboxBefore);
      expect(result.pendingOutboxIds).toEqual(["out-pending"]);
      expect(result.deliveredOutboxIds).toEqual(["out-delivered"]);
      expect(result.desktopGatewayAddedEmpty).toBe(true);
      expect(JSON.parse(await readFile(result.migratedStatePath, "utf8")).schemaVersion).toBe(6);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("restores the hash-verified v5 bytes and reloads without identity or order drift", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-rollback-"));
    try {
      const result = await runV5UpgradeRollbackJourney({ root });
      expect(result.rollbackHash).toBe(result.sourceHash);
      expect(result.rollbackTaskIds).toEqual(result.taskIdsBefore);
      expect(result.rollbackOutbox).toEqual(result.outboxBefore);
      expect(result.rollbackLoadSucceeded).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
