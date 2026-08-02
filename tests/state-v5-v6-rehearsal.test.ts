import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  inspectRollbackEligibility,
  runStateV5V6Rehearsal,
  transformV6ToV5,
} from "../scripts/state-v5-v6-rehearsal.js";

const fixturePath = path.resolve("tests/fixtures/state-v5-complete.json");
const newV6Store = path.resolve("src/state/store.ts");
const adapterId = "weixin:phase3-fixture";

describe("Phase 3 schema-v5/v6 rehearsal", () => {
  test("complete fixture covers every v5 partition and both text/media outbox kinds", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const partition = fixture.adapters[adapterId];

    expect(Object.keys(partition)).toEqual([
      "tasks", "conversations", "chats", "jobs", "outbox",
      "pendingMessages", "processedMessageIds", "diagnostics",
      "imageDrafts", "clarifications", "usageAdvisor",
    ]);
    expect(Object.values(partition.outbox).map((item: any) => item.kind)).toEqual([
      "text", "image", "file",
    ]);
    expect(Object.values(partition.outbox).filter((item: any) => item.sha256)).toHaveLength(2);
  });

  test("rollback fails closed for every active Desktop or delivery obligation", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const partition = fixture.adapters[adapterId];
    const base = structuredClone(partition);
    base.pendingMessages = {};
    base.desktopGateway = { bindings: {}, wakes: {} };

    expect(inspectRollbackEligibility({ schemaVersion: 6, adapters: { [adapterId]: partition } })).toContain(
      `${adapterId}:pending-message:pending-fixture`,
    );

    const cases: Array<[string, (state: any) => void, string]> = [
      ["desktop owner", (state) => addBinding(state, { owner: "desktop", ownerInstanceId: "desktop-one", leaseExpiresAt: "2026-08-02T01:00:00.000Z" }), `${adapterId}:binding:binding-one:owner:desktop`],
      ["uncertain owner", (state) => addBinding(state, { owner: "uncertain" }), `${adapterId}:binding:binding-one:owner:uncertain`],
      ["active bridge binding", (state) => addBinding(state, { owner: "bridge" }), `${adapterId}:binding:binding-one:owner:bridge`],
      ["start fence", (state) => addBinding(state, { owner: "disabled", activeStartFence: { turnId: "turn", originGeneration: 1, requestId: "request", promptCommitment: "a".repeat(64), issuedAt: "2026-08-02T00:00:00.000Z" } }), `${adapterId}:binding:binding-one:start-fence`],
      ["wake", (state) => { addBinding(state, { owner: "disabled", pendingWakeIds: ["wake-one"] }); state.desktopGateway.wakes["wake-one"] = { eventId: "wake-one", bindingId: "binding-one", turnId: "turn", observedAt: "2026-08-02T00:00:00.000Z" }; }, `${adapterId}:binding:binding-one:pending-wake`],
      ["release request", (state) => addBinding(state, { owner: "disabled", releaseRequested: true }), `${adapterId}:binding:binding-one:release-request`],
      ["pending outbox", (state) => { state.outbox["out-text"].status = "pending"; delete state.outbox["out-text"].deliveredAt; }, `${adapterId}:outbox:out-text:pending`],
      ["active job", (state) => { state.jobs["job-text"].status = "running"; delete state.jobs["job-text"].completedAt; }, `${adapterId}:job:job-text:running`],
      ["active task", (state) => { state.tasks["task-complete"].status = "running"; }, `${adapterId}:task:task-complete:running`],
    ];

    for (const [name, mutate, reason] of cases) {
      const candidate = structuredClone(base);
      mutate(candidate);
      expect(inspectRollbackEligibility({ schemaVersion: 6, adapters: { [adapterId]: candidate } }), name).toContain(reason);
    }
  });

  test("canonical v6-to-v5 transform removes only retired Gateway state", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    delete fixture.adapters[adapterId].pendingMessages["pending-fixture"];
    const originalV5 = structuredClone(fixture);
    fixture.schemaVersion = 6;
    fixture.adapters[adapterId].desktopGateway = { bindings: {}, wakes: {} };

    expect(transformV6ToV5(fixture)).toEqual(originalV5);
  });

  test("runs old/new stores in fresh processes and proves copy-only migration and rollback hashes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-v5-v6-rehearsal-"));
    const destination = path.join(tempDir, "result");
    try {
      const oldV5Store = await writePortableV5Store(tempDir);
      const before = await readFile(fixturePath);
      const result = await runStateV5V6Rehearsal({
        source: fixturePath, destination, adapterId, oldV5Store, newV6Store,
      });

      expect(await readFile(fixturePath)).toEqual(before);
      expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.v5BackupHash).toBe(result.materializedV5Hash);
      expect(result.oldV5OnV6.ok).toBeFalse();
      expect(result.oldV5OnV6.error).toMatch(/unsupported.*schema.*6/i);
      expect(result.newV6OnMigratedV6.ok).toBeTrue();
      expect(result.rollbackBlockedReasons).toContain(`${adapterId}:pending-message:pending-fixture`);
      expect(result.oldV5OnRolledBackV5.ok).toBeTrue();
      expect(result.newV6OnRestoredV6.ok).toBeTrue();
      expect(result.migrationPreservationEqual).toBeTrue();
      expect(result.canonicalPreservationEqual).toBeTrue();
      expect(result.oldV5StoreHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.newV6StoreHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.stagedHashes.every((item) => item.before === item.after)).toBeTrue();
      expect(JSON.parse(await readFile(result.rolledBackV5Path, "utf8")).schemaVersion).toBe(5);
      expect(JSON.parse(await readFile(result.restoredV6Path, "utf8")).schemaVersion).toBe(6);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("refuses production source and destination paths by default", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chat2codex-v5-v6-paths-"));
    try {
      await expect(runStateV5V6Rehearsal({
        source: "F:/Chat2Codex/state.json", destination: path.join(tempDir, "result"), adapterId, oldV5Store: fixturePath, newV6Store,
      })).rejects.toThrow(/production source.*explicit approval/i);
      await expect(runStateV5V6Rehearsal({
        source: fixturePath, destination: "F:/Chat2Codex/rehearsal", adapterId, oldV5Store: fixturePath, newV6Store,
      })).rejects.toThrow(/production destination/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function writePortableV5Store(tempDir: string): Promise<string> {
  const modulePath = path.join(tempDir, "portable-v5-store.mjs");
  await writeFile(modulePath, `
import fs from "node:fs/promises";
export class JsonStateStore {
  constructor(filePath, options = {}) { this.filePath = filePath; this.adapterId = options.adapterId; }
  async load() {
    const envelope = JSON.parse(await fs.readFile(this.filePath, "utf8"));
    if (envelope.schemaVersion !== 5) throw new Error("Unsupported bridge state schema version: " + envelope.schemaVersion);
    return envelope.adapters[this.adapterId];
  }
  async save() { throw new Error("Portable v5 probe is read-only."); }
}
`);
  return modulePath;
}

function addBinding(state: any, overrides: Record<string, unknown>): void {
  state.desktopGateway = { bindings: {}, wakes: {} };
  state.desktopGateway.bindings["binding-one"] = {
    bindingId: "binding-one", rootThreadId: "root-thread-v5-fixture", taskId: "task-complete",
    conversationId: "conversation-complete", adapterId, owner: "disabled", generation: 1,
    bindingAnchorTurnId: "anchor", bindingAnchorTurnIndex: 0, lastReconciledTurnId: "anchor",
    lastReconciledTurnIndex: 0, lastAuthoritativeDigest: "b".repeat(64), excludedControlTurns: {},
    pendingWakeIds: [], processedMutationIds: {}, createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z", ...overrides,
  };
}
