import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { JsonStateStore } from "../src/state/store.js";

type Json = Record<string, any>;

const [sourceState, destinationRoot, adapterId] = process.argv.slice(2);
if (!sourceState || !destinationRoot || !adapterId) {
  throw new Error("Usage: bun scripts/state-v4-v5-rehearsal.ts <source-state> <destination-root> <adapter-id>");
}

const source = path.resolve(sourceState);
const root = path.resolve(destinationRoot);
const statePath = path.join(root, "state.json");
const v5Snapshot = path.join(root, "state.v5.snapshot.json");
await fs.mkdir(root, { recursive: true });
await fs.copyFile(source, statePath, fs.constants.COPYFILE_EXCL);

const sha256 = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex");
const readJson = async (file: string) => JSON.parse(await fs.readFile(file, "utf8")) as Json;

function summarizeEnvelope(envelope: Json): Json {
  const adapter = envelope.adapters?.[adapterId] ?? {};
  const tasks = Object.values(adapter.tasks ?? {}) as Json[];
  const threads = tasks.map((task) => task.threadId).filter((value): value is string => typeof value === "string" && value.length > 0);
  const jobs = Object.values(adapter.jobs ?? {}) as Json[];
  const outbox = Object.values(adapter.outbox ?? {}) as Json[];
  const counts = (items: Json[], key: string) => Object.fromEntries(
    [...new Set(items.map((item) => String(item[key] ?? "missing")))].sort().map((value) => [value, items.filter((item) => String(item[key] ?? "missing") === value).length]),
  );
  return {
    schemaVersion: envelope.schemaVersion,
    adapterCount: Object.keys(envelope.adapters ?? {}).length,
    tasks: tasks.length,
    conversations: Object.keys(adapter.conversations ?? {}).length,
    chats: Object.keys(adapter.chats ?? {}).length,
    jobs: jobs.length,
    jobsByStatus: counts(jobs, "status"),
    outbox: outbox.length,
    outboxByStatus: counts(outbox, "status"),
    outboxByKind: counts(outbox, "kind"),
    pendingMessages: Object.keys(adapter.pendingMessages ?? {}).length,
    imageDrafts: Object.keys(adapter.imageDrafts ?? {}).length,
    clarifications: Object.keys(adapter.clarifications ?? {}).length,
    processedMessageIds: Array.isArray(adapter.processedMessageIds) ? adapter.processedMessageIds.length : 0,
    threadCount: threads.length,
    uniqueThreadCount: new Set(threads).size,
  };
}

const originalHash = await sha256(statePath);
const before = summarizeEnvelope(await readJson(statePath));
if (before.schemaVersion !== 4) throw new Error(`Expected source schema v4, received ${before.schemaVersion}`);

const store = new JsonStateStore(statePath, {
  adapterId,
  chat2codexHome: root,
  jobRetentionCount: 1_000_000,
  outboxRetentionCount: 1_000_000,
  outboundMediaRetentionHours: 24,
});
const state = await store.load();
await store.save(state);
const migrated = await readJson(statePath);
const after = summarizeEnvelope(migrated);
if (after.schemaVersion !== 5) throw new Error("Migration did not produce schema v5.");

const backupPath = statePath + ".v4.bak";
const backupHash = await sha256(backupPath);
if (backupHash !== originalHash) throw new Error("The v4 backup does not match the source state bytes.");
await fs.copyFile(statePath, v5Snapshot, fs.constants.COPYFILE_EXCL);

console.log(JSON.stringify({
  source,
  root,
  adapterSuffix: createHash("sha256").update(adapterId).digest("hex").slice(-8),
  originalHash,
  backupHash,
  migratedHash: await sha256(statePath),
  before,
  after,
  invariantEqual: JSON.stringify({ ...before, schemaVersion: 5 }) === JSON.stringify(after),
  statePath,
  backupPath,
  v5Snapshot,
}, null, 2));
