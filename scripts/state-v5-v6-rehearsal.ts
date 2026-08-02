import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

type JsonRecord = Record<string, any>;

export interface StateV5V6RehearsalOptions {
  source: string;
  destination: string;
  adapterId: string;
  oldV5Store: string;
  newV6Store: string;
  allowProductionSource?: boolean;
}

export interface StoreProbeResult {
  ok: boolean;
  schemaVersion?: number;
  adapterId?: string;
  summary?: JsonRecord;
  error?: string;
}

export interface StateV5V6RehearsalResult {
  source: string;
  destination: string;
  adapterSuffix: string;
  sourceHash: string;
  oldV5StoreHash: string;
  newV6StoreHash: string;
  scriptHash: string;
  materializedV5Hash: string;
  v5BackupHash: string;
  migratedV6Hash: string;
  rolledBackV5Hash: string;
  restoredV6Hash: string;
  migratedV6Path: string;
  rolledBackV5Path: string;
  restoredV6Path: string;
  oldV5OnSourceV5: StoreProbeResult;
  oldV5OnV6: StoreProbeResult;
  newV6OnMigratedV6: StoreProbeResult;
  oldV5OnRolledBackV5: StoreProbeResult;
  newV6OnRestoredV6: StoreProbeResult;
  rollbackBlockedReasons: string[];
  migrationPreservationEqual: boolean;
  canonicalPreservationEqual: boolean;
  stagedHashes: Array<{ pathSuffix: string; before: string; after: string }>;
  summaries: { sourceV5: JsonRecord; migratedV6: JsonRecord; rolledBackV5: JsonRecord };
}

const scriptPath = fileURLToPath(import.meta.url);
const fixtureMedia = "phase3-media-fixture-v1\n";
const fixtureDraft = "phase3-draft-fixture-v1\n";
const inactiveTaskStatuses = new Set(["completed", "failed", "interrupted", "archived"]);
const inactiveJobStatuses = new Set(["completed", "failed", "cancelled", "interrupted"]);

export async function runStateV5V6Rehearsal(
  options: StateV5V6RehearsalOptions,
): Promise<StateV5V6RehearsalResult> {
  const source = path.resolve(options.source);
  const destination = path.resolve(options.destination);
  const oldV5Store = path.resolve(options.oldV5Store);
  const newV6Store = path.resolve(options.newV6Store);
  await assertSafePaths(source, destination, options.allowProductionSource === true);
  await assertRegularFile(source, "source state");
  await assertRegularFile(oldV5Store, "old v5 store module");
  await assertRegularFile(newV6Store, "new v6 store module");
  await fs.mkdir(destination, { recursive: false });

  const sourceBytes = await fs.readFile(source);
  const sourceEnvelope = JSON.parse(sourceBytes.toString("utf8")) as JsonRecord;
  if (sourceEnvelope.schemaVersion !== 5 || !isRecord(sourceEnvelope.adapters)) {
    throw new Error("Source must be a schema-v5 adapter envelope.");
  }
  if (!isRecord(sourceEnvelope.adapters[options.adapterId])) {
    throw new Error(`Source does not contain adapter ${options.adapterId}.`);
  }

  const materializedV5 = materializeFixturePaths(sourceEnvelope, destination);
  const statePath = path.join(destination, "state.v5.input.json");
  await writeJsonExclusive(statePath, materializedV5);
  await createFixtureFiles(destination);
  const stagedBefore = await hashReferencedFiles(materializedV5);

  const oldV5OnSourceV5 = await runFreshStore("probe", oldV5Store, statePath, options.adapterId, destination);
  requireProbe(oldV5OnSourceV5, "old v5 on source v5");

  const migratedV6Path = path.join(destination, "state.v6.migrated.json");
  await fs.copyFile(statePath, migratedV6Path, fs.constants.COPYFILE_EXCL);
  const migrateResult = await runFreshStore("migrate", newV6Store, migratedV6Path, options.adapterId, destination);
  requireProbe(migrateResult, "new v6 migration");
  const v5BackupPath = `${migratedV6Path}.v5.bak`;
  const v5BackupHash = await sha256File(v5BackupPath);
  const materializedV5Hash = await sha256File(statePath);
  if (v5BackupHash !== materializedV5Hash) {
    throw new Error("Schema-v5 migration backup differs from the exact input bytes.");
  }

  const oldV5OnV6 = await runFreshStore("probe", oldV5Store, migratedV6Path, options.adapterId, destination);
  if (oldV5OnV6.ok || !/unsupported.*schema.*6/iu.test(oldV5OnV6.error ?? "")) {
    throw new Error("Old schema-v5 runtime did not fail closed on schema v6.");
  }
  const newV6OnMigratedV6 = await runFreshStore("probe", newV6Store, migratedV6Path, options.adapterId, destination);
  requireProbe(newV6OnMigratedV6, "new v6 on migrated v6");

  const migratedV6 = await readJson(migratedV6Path);
  const migrationProjection = projectV5(migratedV6);
  const migrationPreservationEqual = canonicalJson(migrationProjection) === canonicalJson(materializedV5);
  if (!migrationPreservationEqual) {
    throw new Error("Schema-v5 to v6 migration changed a pre-existing v5 field.");
  }
  const rollbackBlockedReasons = inspectRollbackEligibility(migratedV6);
  if (rollbackBlockedReasons.length === 0) {
    throw new Error("The complete fixture must prove at least one rollback obligation.");
  }

  const eligibleV6 = structuredClone(migratedV6);
  settleFixtureObligations(eligibleV6);
  const remaining = inspectRollbackEligibility(eligibleV6);
  if (remaining.length > 0) {
    throw new Error(`Fixture obligations could not be settled: ${remaining.join(", ")}`);
  }
  const rolledBackV5 = transformV6ToV5(eligibleV6);
  const expectedV5 = structuredClone(materializedV5);
  settleFixtureObligations(expectedV5);
  const canonicalPreservationEqual = canonicalJson(rolledBackV5) === canonicalJson(expectedV5);
  if (!canonicalPreservationEqual) {
    throw new Error("Canonical v6-to-v5 transform changed a schema-v5 partition field.");
  }

  const rolledBackV5Path = path.join(destination, "state.v5.rolled-back.json");
  await writeJsonExclusive(rolledBackV5Path, rolledBackV5);
  const oldV5OnRolledBackV5 = await runFreshStore("probe", oldV5Store, rolledBackV5Path, options.adapterId, destination);
  requireProbe(oldV5OnRolledBackV5, "old v5 on rolled-back v5");

  const restoredV6Path = path.join(destination, "state.v6.restored.json");
  await fs.copyFile(migratedV6Path, restoredV6Path, fs.constants.COPYFILE_EXCL);
  const newV6OnRestoredV6 = await runFreshStore("probe", newV6Store, restoredV6Path, options.adapterId, destination);
  requireProbe(newV6OnRestoredV6, "new v6 on restored v6");

  const stagedAfter = await hashReferencedFiles(rolledBackV5);
  const stagedHashes = compareFileHashes(stagedBefore, stagedAfter);
  if (stagedHashes.some((entry) => entry.before !== entry.after)) {
    throw new Error("A staged file hash changed during copy-only rehearsal.");
  }

  const result: StateV5V6RehearsalResult = {
    source, destination,
    adapterSuffix: createHash("sha256").update(options.adapterId).digest("hex").slice(-8),
    sourceHash: sha256Bytes(sourceBytes),
    oldV5StoreHash: await sha256File(oldV5Store),
    newV6StoreHash: await sha256File(newV6Store),
    scriptHash: await sha256File(scriptPath),
    materializedV5Hash, v5BackupHash,
    migratedV6Hash: await sha256File(migratedV6Path),
    rolledBackV5Hash: await sha256File(rolledBackV5Path),
    restoredV6Hash: await sha256File(restoredV6Path),
    migratedV6Path, rolledBackV5Path, restoredV6Path,
    oldV5OnSourceV5, oldV5OnV6, newV6OnMigratedV6, oldV5OnRolledBackV5, newV6OnRestoredV6,
    rollbackBlockedReasons, migrationPreservationEqual, canonicalPreservationEqual, stagedHashes,
    summaries: {
      sourceV5: summarizeEnvelope(expectedV5),
      migratedV6: summarizeEnvelope(eligibleV6),
      rolledBackV5: summarizeEnvelope(rolledBackV5),
    },
  };
  const reportPath = path.join(destination, "rehearsal-result.json");
  await writeJsonExclusive(reportPath, result);
  return result;
}

export function inspectRollbackEligibility(envelope: unknown): string[] {
  if (!isRecord(envelope) || envelope.schemaVersion !== 6 || !isRecord(envelope.adapters)) {
    throw new Error("Rollback eligibility requires a schema-v6 adapter envelope.");
  }
  const reasons: string[] = [];
  for (const [adapterId, rawState] of Object.entries(envelope.adapters)) {
    if (!isRecord(rawState)) { reasons.push(`${adapterId}:malformed-partition`); continue; }
    const gateway = isRecord(rawState.desktopGateway) ? rawState.desktopGateway : {};
    const bindings = isRecord(gateway.bindings) ? gateway.bindings : {};
    const wakes = isRecord(gateway.wakes) ? gateway.wakes : {};
    for (const [bindingId, rawBinding] of Object.entries(bindings)) {
      if (!isRecord(rawBinding)) { reasons.push(`${adapterId}:binding:${bindingId}:malformed`); continue; }
      if (rawBinding.owner !== "disabled") reasons.push(`${adapterId}:binding:${bindingId}:owner:${String(rawBinding.owner)}`);
      if (rawBinding.activeStartFence !== undefined) reasons.push(`${adapterId}:binding:${bindingId}:start-fence`);
      if (Array.isArray(rawBinding.pendingWakeIds) && rawBinding.pendingWakeIds.length > 0) reasons.push(`${adapterId}:binding:${bindingId}:pending-wake`);
      if (rawBinding.releaseRequested === true) reasons.push(`${adapterId}:binding:${bindingId}:release-request`);
    }
    for (const wakeId of Object.keys(wakes)) reasons.push(`${adapterId}:wake:${wakeId}`);
    for (const pendingId of Object.keys(isRecord(rawState.pendingMessages) ? rawState.pendingMessages : {})) reasons.push(`${adapterId}:pending-message:${pendingId}`);
    for (const [outboxId, rawOutbox] of Object.entries(isRecord(rawState.outbox) ? rawState.outbox : {})) {
      if (!isRecord(rawOutbox) || rawOutbox.status !== "delivered") reasons.push(`${adapterId}:outbox:${outboxId}:${String(isRecord(rawOutbox) ? rawOutbox.status : "malformed")}`);
    }
    for (const [jobId, rawJob] of Object.entries(isRecord(rawState.jobs) ? rawState.jobs : {})) {
      if (!isRecord(rawJob) || !inactiveJobStatuses.has(String(rawJob.status))) reasons.push(`${adapterId}:job:${jobId}:${String(isRecord(rawJob) ? rawJob.status : "malformed")}`);
    }
    for (const [taskId, rawTask] of Object.entries(isRecord(rawState.tasks) ? rawState.tasks : {})) {
      if (!isRecord(rawTask) || !inactiveTaskStatuses.has(String(rawTask.status))) reasons.push(`${adapterId}:task:${taskId}:${String(isRecord(rawTask) ? rawTask.status : "malformed")}`);
    }
  }
  return [...new Set(reasons)].sort();
}

export function transformV6ToV5(envelope: unknown): JsonRecord {
  const reasons = inspectRollbackEligibility(envelope);
  if (reasons.length > 0) throw new Error(`Schema-v6 rollback is blocked: ${reasons.join(", ")}`);
  return projectV5(envelope as JsonRecord);
}

function projectV5(envelope: JsonRecord): JsonRecord {
  const transformed = structuredClone(envelope);
  transformed.schemaVersion = 5;
  for (const state of Object.values(transformed.adapters) as JsonRecord[]) delete state.desktopGateway;
  return transformed;
}

async function childStoreOperation(
  operation: "probe" | "migrate", modulePath: string, statePath: string, adapterId: string, home: string,
): Promise<void> {
  let result: StoreProbeResult;
  try {
    const imported = await import(pathToFileURL(path.resolve(modulePath)).href);
    const store = new imported.JsonStateStore(path.resolve(statePath), {
      adapterId, chat2codexHome: path.resolve(home), jobRetentionCount: 1_000_000,
      outboxRetentionCount: 1_000_000, outboundMediaRetentionHours: 24 * 365,
    });
    const state = await store.load();
    if (operation === "migrate") await store.save(state);
    const envelope = await readJson(path.resolve(statePath));
    result = { ok: true, schemaVersion: envelope.schemaVersion, adapterId, summary: summarizeEnvelope(envelope) };
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  process.stdout.write(JSON.stringify(result));
}

async function runFreshStore(
  operation: "probe" | "migrate", modulePath: string, statePath: string, adapterId: string, home: string,
): Promise<StoreProbeResult> {
  const child = spawn(process.execPath, [scriptPath, `__${operation}`, modulePath, statePath, adapterId, home], {
    cwd: path.dirname(scriptPath), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    collect(child.stdout), collect(child.stderr), new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }),
  ]);
  if (exitCode !== 0) throw new Error(`Fresh store process exited ${String(exitCode)}: ${stderr.trim()}`);
  try { return JSON.parse(stdout) as StoreProbeResult; }
  catch { throw new Error(`Fresh store process returned malformed JSON: ${stdout.slice(0, 200)}`); }
}

function settleFixtureObligations(envelope: JsonRecord): void {
  for (const state of Object.values(envelope.adapters ?? {}) as JsonRecord[]) {
    state.pendingMessages = {};
  }
}

function summarizeEnvelope(envelope: JsonRecord): JsonRecord {
  const adapters = Object.fromEntries(Object.entries(envelope.adapters ?? {}).map(([adapterId, raw]) => {
    const state = raw as JsonRecord;
    const outbox = Object.values(state.outbox ?? {}) as JsonRecord[];
    return [adapterId, {
      counts: Object.fromEntries(["tasks", "conversations", "chats", "jobs", "outbox", "pendingMessages", "imageDrafts", "clarifications"].map((key) => [key, Object.keys(state[key] ?? {}).length])),
      processedMessageIds: [...(state.processedMessageIds ?? [])],
      conversationTaskOrder: Object.fromEntries(Object.entries(state.conversations ?? {}).map(([key, item]: [string, any]) => [key, [...(item.taskIds ?? [])]])),
      jobDeliveryOrder: Object.fromEntries(Object.entries(state.jobs ?? {}).map(([key, item]: [string, any]) => [key, [...(item.deliveryIds ?? [])]])),
      outboxOrder: outbox.map((item) => `${item.jobId}:${item.sequence}:${item.id}:${item.kind}:${item.status}`),
      stagedHashes: outbox.filter((item) => item.sha256).map((item) => `${item.id}:${item.sha256}:${item.size}`),
      usageAdvisorDigest: sha256Text(canonicalJson(state.usageAdvisor ?? {})),
      diagnosticsDigest: sha256Text(canonicalJson(state.diagnostics ?? {})),
    }];
  }));
  return { schemaVersion: envelope.schemaVersion, adapterCount: Object.keys(adapters).length, adapters };
}

function materializeFixturePaths(value: unknown, root: string): JsonRecord {
  const normalized = path.resolve(root);
  return replaceFixtureRoot(structuredClone(value), normalized) as JsonRecord;
}
function replaceFixtureRoot(value: unknown, root: string): unknown {
  if (typeof value === "string" && value.includes("__REHEARSAL_ROOT__")) {
    return path.normalize(value.replaceAll("__REHEARSAL_ROOT__", root));
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => replaceFixtureRoot(item, root));
  if (!isRecord(value)) return value;
  for (const key of Object.keys(value)) value[key] = replaceFixtureRoot(value[key], root);
  return value;
}

async function createFixtureFiles(root: string): Promise<void> {
  const mediaDirectory = path.join(root, "outbound", "task-complete", "job-media");
  const inboundDirectory = path.join(root, "inbound");
  await fs.mkdir(mediaDirectory, { recursive: true });
  await fs.mkdir(inboundDirectory, { recursive: true });
  await fs.writeFile(path.join(mediaDirectory, "00-image.png"), fixtureMedia, { flag: "wx" });
  await fs.writeFile(path.join(mediaDirectory, "01-evidence.txt"), fixtureMedia, { flag: "wx" });
  await fs.writeFile(path.join(inboundDirectory, "draft-image.png"), fixtureDraft, { flag: "wx" });
}

async function hashReferencedFiles(envelope: JsonRecord): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const state of Object.values(envelope.adapters ?? {}) as JsonRecord[]) {
    for (const item of Object.values(state.outbox ?? {}) as JsonRecord[]) if (typeof item.stagedPath === "string") {
      const digest = await sha256File(item.stagedPath);
      const size = (await fs.stat(item.stagedPath)).size;
      if (item.sha256 !== digest || item.size !== size) throw new Error(`Outbox staged metadata mismatch: ${String(item.id)}`);
      result.set(item.stagedPath, digest);
    }
    for (const draft of Object.values(state.imageDrafts ?? {}) as JsonRecord[]) for (const image of draft.images ?? []) if (typeof image.path === "string") {
      const digest = await sha256File(image.path);
      const size = (await fs.stat(image.path)).size;
      if (image.sha256 !== digest || image.bytes !== size) throw new Error(`Image draft staged metadata mismatch: ${String(image.sourceMessageId)}`);
      result.set(image.path, digest);
    }
  }
  return result;
}

function compareFileHashes(before: Map<string, string>, after: Map<string, string>) {
  if (before.size !== after.size || [...before.keys()].some((key) => !after.has(key))) throw new Error("Referenced staged-file set changed during rehearsal.");
  return [...before.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([file, hash]) => ({
    pathSuffix: file.replaceAll("\\", "/").split("/").slice(-4).join("/"), before: hash, after: after.get(file)!,
  }));
}

async function assertSafePaths(source: string, destination: string, allowProductionSource: boolean): Promise<void> {
  if (insideProduction(source) && !allowProductionSource) throw new Error("Production source requires explicit approval and --allow-production-source.");
  if (insideProduction(destination)) throw new Error("Production destination is forbidden; use a disposable copy directory.");
  if (samePath(source, destination) || inside(source, destination) || inside(destination, source)) throw new Error("Source and destination must be separate explicit paths.");
  const sourceReal = await fs.realpath(source).catch(() => source);
  const destinationParentReal = await fs.realpath(path.dirname(destination)).catch(() => path.dirname(destination));
  const destinationRealCandidate = path.join(destinationParentReal, path.basename(destination));
  if (insideProduction(sourceReal) && !allowProductionSource) throw new Error("Production source requires explicit approval and --allow-production-source.");
  if (insideProduction(destinationRealCandidate)) throw new Error("Production destination is forbidden; use a disposable copy directory.");
}

function insideProduction(candidate: string): boolean { return inside(path.resolve("F:/Chat2Codex"), candidate); }
function inside(root: string, candidate: string): boolean { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function samePath(left: string, right: string): boolean { return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right; }

async function assertRegularFile(file: string, name: string): Promise<void> { const info = await fs.lstat(file); if (!info.isFile() || info.isSymbolicLink() || !samePath(await fs.realpath(file), file)) throw new Error(`${name} must be a canonical regular non-symlink file.`); }
async function readJson(file: string): Promise<JsonRecord> { return JSON.parse(await fs.readFile(file, "utf8")) as JsonRecord; }
async function writeJsonExclusive(file: string, value: unknown): Promise<void> { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
async function sha256File(file: string): Promise<string> { return sha256Bytes(await fs.readFile(file)); }
function sha256Bytes(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function sha256Text(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
function canonicalize(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonicalize); if (!isRecord(value)) return value; return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])); }
function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireProbe(result: StoreProbeResult, label: string): void { if (!result.ok) throw new Error(`${label} failed: ${result.error ?? "unknown error"}`); }
async function collect(stream: NodeJS.ReadableStream | null): Promise<string> { if (!stream) return ""; const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return Buffer.concat(chunks).toString("utf8"); }

async function main(argv: string[]): Promise<void> {
  if (argv[0] === "__probe" || argv[0] === "__migrate") {
    const [operation, modulePath, statePath, adapterId, home] = argv;
    if (!modulePath || !statePath || !adapterId || !home) throw new Error("Internal store operation is incomplete.");
    await childStoreOperation(operation === "__probe" ? "probe" : "migrate", modulePath, statePath, adapterId, home);
    return;
  }
  const [source, destination, adapterId, oldV5Store, newV6Store, ...flags] = argv;
  if (!source || !destination || !adapterId || !oldV5Store || !newV6Store) {
    throw new Error("Usage: bun scripts/state-v5-v6-rehearsal.ts <source-v5> <new-destination> <adapter-id> <old-v5-store-module> <new-v6-store-module> [--allow-production-source]");
  }
  const unknownFlags = flags.filter((flag) => flag !== "--allow-production-source");
  if (unknownFlags.length) throw new Error(`Unknown flag: ${unknownFlags.join(", ")}`);
  console.log(JSON.stringify(await runStateV5V6Rehearsal({ source, destination, adapterId, oldV5Store, newV6Store, allowProductionSource: flags.includes("--allow-production-source") }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  await main(process.argv.slice(2));
}
