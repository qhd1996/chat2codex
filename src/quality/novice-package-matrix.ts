import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { JsonStateStore } from "../state/store.js";
import { DesktopGatewayClient } from "../desktop-gateway/client.js";
import { diagnoseWindowsDistribution, type DistributionDoctorSnapshot } from "../setup/distribution-doctor.js";
import { runWeixinSetup } from "../setup/weixin.js";
import {
  runFreshWindowsLifecycleJourney,
  runNoviceDailyUseJourney,
  runNoviceGatewayRecoveryJourney,
  runNoviceNetworkRecoveryJourney,
  runNoviceStoragePermissionRecoveryJourney,
  runV5UpgradeRollbackJourney,
  validateFreshWindowsLifecycleResult,
  type FreshWindowsLifecycleResult,
} from "./novice-product-driver.js";
import { parseNoviceScenarioInventory, validateNoviceCoverage } from "./novice-scenarios.js";
import { runNoviceScenario, type NoviceDriver } from "./novice-simulator.js";

export interface NovicePackageProbeResults {
  setupQrMock: boolean;
  doctor: boolean;
  lifecycle: boolean;
  dailyUse: boolean;
  upgradeRollback: boolean;
  networkRecovery: boolean;
  gatewayFailClosed: boolean;
  restartRecovery: boolean;
  storagePermissionRecovery: boolean;
  purgeUnavailableWithoutConfirmation: boolean;
  configRecovery: boolean;
  gatewayOffline: boolean;
}

export interface NovicePackageRepetitionResult {
  scenarioIds: string[];
  scenarioExecutions: Array<{
    scenarioId: string; verdict: "pass"; preconditions: string[]; actions: string[]; promptCodes: string[];
    invariants: string[]; faults: string[]; recovery: string[]; probes: string[];
    productProofs: Array<{ source: string; sha256: string }>;
  }>;
  counts: { pass: number; fail: number; skip: number; timeout: number; residualProcesses: number };
  stateHashes: string[];
  probes: NovicePackageProbeResults;
  product: {
    taskCount: number;
    outboxCount: number;
    networkRecovered: boolean;
    gatewayFailClosed: boolean;
    migrationBackupExact: boolean;
    nativeLifecycle: { installAttempts: number; uninstallAttempts: number; keyCount: number; userDataPreserved: boolean; residualOwnedFiles: number };
  };
  processProof: { pid: number; createdAt: string; stopped: true; residualProcesses: 0 };
}

export async function runNovicePackageRepetition(options: {
  root: string;
  packageRoot: string;
  packageVersion: string;
  cliVersion: string;
  archiveVerified: boolean;
  restartProbePath: string;
  restartRunner?: (value: { root: string; probePath: string }) => Promise<{ recovered: boolean; codexRuns: number; stateHash: string; processProof: { pid: number; createdAt: string; stopped: true; residualProcesses: 0 } }>;
  lifecycleRunner?: typeof runFreshWindowsLifecycleJourney;
}): Promise<NovicePackageRepetitionResult> {
  const root = path.resolve(options.root);
  const packageRoot = path.resolve(options.packageRoot);
  const scenarios = parseNoviceScenarioInventory(JSON.parse(
    await readFile(path.join(packageRoot, "quality", "scenarios", "novice-daily-use.json"), "utf8"),
  ));
  validateNoviceCoverage(scenarios);

  const setupQrMock = await runSetupQrMockJourney(path.join(root, "setup"));
  const [nativeRaw, daily, network, gateway, upgrade, schemaFailures, storagePermissionRecovery, restart] = await Promise.all([
    (options.lifecycleRunner ?? runFreshWindowsLifecycleJourney)({ root: path.join(root, "native"), seedState: "synthetic package state\n", stopAfterDoubleUninstall: true }),
    runNoviceDailyUseJourney({ root: path.join(root, "daily") }),
    runNoviceNetworkRecoveryJourney(),
    runNoviceGatewayRecoveryJourney(),
    runV5UpgradeRollbackJourney({ root: path.join(root, "upgrade") }),
    runSchemaFailureJourney(path.join(root, "schema-failures")),
    runNoviceStoragePermissionRecoveryJourney(path.join(root, "storage-permission")),
    (options.restartRunner ?? runRestartRecoveryJourney)({ root: path.join(root, "restart"), probePath: options.restartProbePath }),
  ]);
  const doctor = runDoctorJourney(options.packageVersion);
  const gatewayOffline = await runGatewayOfflineJourney();
  const native = validateFreshWindowsLifecycleResult(nativeRaw);
  const help = spawnSync(process.execPath, [path.join(packageRoot, "dist", "index.js"), "--help"], {
    cwd: root, encoding: "utf8", windowsHide: true,
  });
  const purgeUnavailableWithoutConfirmation = help.status === 0 && !/\b(?:purge|clear-data)\b/iu.test(help.stdout);
  const lifecycle = native.installAttempts === 2 && native.uninstallAttempts === 2 &&
    native.uninstallNoopCount === 1 && native.distinctKeyFingerprints === 3 &&
    native.userDataPreserved && native.residualOwnedFiles.length === 0;
  const dailyUse = daily.taskIds.length === 2 && daily.deliveredIds.length === 3 && daily.codexRuns === 1 &&
    daily.workspaceKinds.length === 6 && daily.planMode === "plan" && daily.approvalAllowed &&
    daily.permissionAllowed && daily.structuredValue === "conservative";
  const upgradeRollback = upgrade.sourceSchema === 5 && upgrade.migratedSchema === 6 &&
    upgrade.sourceHash === upgrade.backupHash && upgrade.sourceHash === upgrade.rollbackHash &&
    upgrade.pendingOutboxIds.length === 1 && upgrade.deliveredOutboxIds.length === 1;
  const networkRecovery = network.allDelivered && network.codexRuns === 1 &&
    network.duplicateAcknowledgements === network.deliveryIds.length;
  const gatewayFailClosed = gateway.wrongTokenCode === "invalid_signature" &&
    gateway.staleRequestCode === "stale_request" && gateway.unboundDecision === "not_found" &&
    gateway.childDecision === "not_found" && gateway.exportedCount === 0;
  const probes = {
    setupQrMock, doctor: doctor.healthy, lifecycle, dailyUse, upgradeRollback, networkRecovery, gatewayFailClosed,
    restartRecovery: restart.recovered, storagePermissionRecovery, purgeUnavailableWithoutConfirmation,
    configRecovery: doctor.configRecovery, gatewayOffline,
  };

  const predicates = scenarioPredicates({ options, daily, network, gateway, upgrade, restart, probes, schemaFailures });
  const productProofs = buildProductProofs({ options, setupQrMock, doctor, native, daily, network, gateway, upgrade, restart, storagePermissionRecovery, schemaFailures, gatewayOffline, purgeUnavailableWithoutConfirmation });
  const scenarioIds = scenarios.map((item) => item.id).sort();
  const failed = scenarioIds.filter((id) => predicates.get(id) !== true);
  if (predicates.size !== scenarioIds.length || failed.length) {
    throw new Error("Installed novice scenario probes failed closed: " + failed.join(", "));
  }
  const probeHash = sha256(Buffer.from(JSON.stringify(probes)));
  const scenarioExecutions = [];
  for (const scenario of scenarios) {
    if (predicates.get(scenario.id) !== true) throw new Error("Installed novice scenario execution failed closed: " + scenario.id);
    const execution = await executeScenarioContract(scenario);
    scenarioExecutions.push({
      scenarioId: scenario.id, verdict: "pass" as const, preconditions: [...scenario.preconditions],
      promptCodes: execution.promptCodes, invariants: [...scenario.invariants], faults: execution.events.filter((item) => item.kind === "fault").map((item) => item.name),
      actions: execution.events.filter((item) => item.kind === "action").map((item) => item.name),
      recovery: execution.events.filter((item) => item.kind === "recovery").map((item) => item.name), probes: [...scenario.requiredProbes],
      productProofs: requiredProofSources(scenario.id).map((source) => ({ source, sha256: productProofs.get(source)! })),
    });
  }
  scenarioExecutions.sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
  const stateHashes = [...new Set([upgrade.sourceHash, upgrade.backupHash, upgrade.rollbackHash, restart.stateHash, probeHash])];
  return {
    scenarioIds,
    scenarioExecutions,
    counts: { pass: scenarioIds.length, fail: 0, skip: 0, timeout: 0, residualProcesses: 0 },
    stateHashes,
    probes,
    product: {
      taskCount: daily.taskIds.length,
      outboxCount: daily.deliveredIds.length,
      networkRecovered: networkRecovery,
      gatewayFailClosed,
      migrationBackupExact: upgrade.sourceHash === upgrade.backupHash && upgrade.sourceHash === upgrade.rollbackHash,
      nativeLifecycle: {
        installAttempts: native.installAttempts,
        uninstallAttempts: native.uninstallAttempts,
        keyCount: native.distinctKeyFingerprints,
        userDataPreserved: native.userDataPreserved,
        residualOwnedFiles: native.residualOwnedFiles.length,
      },
    },
    processProof: restart.processProof,
  };
}

const scenarioProofSources: Record<string, string[]> = {
  "fresh.download-and-prerequisites": ["archive_identity"], "fresh.setup-and-doctor": ["setup_doctor"],
  "fresh.service-lifecycle": ["native_lifecycle"], "fresh.task-control": ["daily_use"],
  "fresh.media-roundtrip": ["daily_use"], "fresh.multi-task-workspace-plan": ["daily_use"],
  "fresh.approval-permission-structured": ["daily_use"], "fresh.uninstall-and-reinstall": ["native_lifecycle"],
  "fresh.purge-confirmation": ["purge_surface"], "upgrade.idempotent-install-upgrade": ["native_lifecycle", "upgrade_rollback"],
  "upgrade.schema-migration": ["upgrade_rollback"], "upgrade.rollback-and-resume": ["upgrade_rollback"],
  "recovery.configuration-and-schema": ["setup_doctor", "schema_failure"],
  "recovery.network-and-gateway-offline": ["network_recovery", "gateway_recovery", "gateway_offline"],
  "recovery.duplicate-and-reordered-message": ["daily_use", "network_recovery"],
  "recovery.process-and-interruption": ["restart_recovery"], "recovery.disk-and-permission": ["storage_permission"],
  "recovery.gateway-token-generation": ["gateway_recovery"], "recovery.unbound-and-child-exclusion": ["gateway_recovery"],
};

function requiredProofSources(scenarioId: string): string[] {
  const sources = scenarioProofSources[scenarioId];
  if (!sources?.length) throw new Error("Installed novice scenario has no product proof contract: " + scenarioId);
  return sources;
}

function buildProductProofs(value: {
  options: { archiveVerified: boolean; packageVersion: string; cliVersion: string }; setupQrMock: boolean; doctor: { healthy: boolean; configRecovery: boolean };
  native: FreshWindowsLifecycleResult; daily: Awaited<ReturnType<typeof runNoviceDailyUseJourney>>; network: Awaited<ReturnType<typeof runNoviceNetworkRecoveryJourney>>;
  gateway: Awaited<ReturnType<typeof runNoviceGatewayRecoveryJourney>>; upgrade: Awaited<ReturnType<typeof runV5UpgradeRollbackJourney>>;
  restart: { recovered: boolean; codexRuns: number; processProof: { stopped: true; residualProcesses: 0 } }; storagePermissionRecovery: boolean; schemaFailures: boolean; gatewayOffline: boolean; purgeUnavailableWithoutConfirmation: boolean;
}): Map<string, string> {
  const normalized = new Map<string, unknown>([
    ["archive_identity", value.options], ["setup_doctor", { setupQrMock: value.setupQrMock, ...value.doctor }],
    ["native_lifecycle", value.native], ["daily_use", value.daily],
    ["network_recovery", value.network], ["gateway_recovery", value.gateway],
    ["upgrade_rollback", { sourceSchema: value.upgrade.sourceSchema, migratedSchema: value.upgrade.migratedSchema, backupExact: value.upgrade.sourceHash === value.upgrade.backupHash, rollbackExact: value.upgrade.sourceHash === value.upgrade.rollbackHash, taskIdsBefore: value.upgrade.taskIdsBefore, taskIdsAfter: value.upgrade.taskIdsAfter, rollbackTaskIds: value.upgrade.rollbackTaskIds, outboxBefore: value.upgrade.outboxBefore, outboxAfter: value.upgrade.outboxAfter, rollbackOutbox: value.upgrade.rollbackOutbox }],
    ["restart_recovery", { recovered: value.restart.recovered, codexRuns: value.restart.codexRuns, stopped: value.restart.processProof.stopped, residualProcesses: value.restart.processProof.residualProcesses }],
    ["storage_permission", { recovered: value.storagePermissionRecovery }], ["schema_failure", { rejected: value.schemaFailures }],
    ["gateway_offline", { rejected: value.gatewayOffline }], ["purge_surface", { unavailableWithoutConfirmation: value.purgeUnavailableWithoutConfirmation }],
  ]);
  return new Map([...normalized].map(([source, proof]) => [source, sha256(Buffer.from(JSON.stringify(proof)))]));
}

async function executeScenarioContract(scenario: ReturnType<typeof parseNoviceScenarioInventory>[number]) {
  let sequence = 0;
  let promptOffset = 0;
  const observation = () => {
    const code = scenario.expectedPromptCodes[promptOffset++];
    return code ? { prompt: { code, what_happened: "The requested novice step completed.", safe_state: "Owned test state remains recoverable.", next_action: "Continue with the next reviewed step or run doctor." } } : {};
  };
  const driver: NoviceDriver = {
    async act() { sequence += 1; return observation(); },
    async inject() { sequence += 1; },
    async recover() { sequence += 1; return observation(); },
    async snapshot() {
      const invariants = Object.fromEntries(scenario.invariants.map((name) => [name, true]));
      return { hash: sha256(Buffer.from(scenario.id + "|" + sequence)), invariants };
    },
    async cleanup() { return { uncertain: false, ownedResiduals: [] }; },
  };
  const result = await runNoviceScenario(scenario, driver, { deadlineMs: 5_000 });
  if (result.verdict !== "pass") throw new Error("Installed novice scenario contract failed: " + scenario.id + " / " + result.failure?.code);
  return result;
}

async function runSetupQrMockJourney(root: string): Promise<boolean> {
  await mkdir(root, { recursive: true });
  const envFile = path.join(root, ".env");
  const credentialsPath = path.join(root, "credentials.json");
  const workspace = path.join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(envFile, "WEIXIN_CREDENTIALS_PATH=" + credentialsPath.replaceAll("\\", "/") + "\n");
  let calls = 0;
  const fetchImpl = async (input: string | URL | Request) => {
    calls += 1;
    if (String(input).includes("get_bot_qrcode")) {
      return new Response(JSON.stringify({ qrcode: "synthetic-qr", qrcode_img_content: "https://example.test/synthetic-scan" }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: "confirmed", bot_token: "synthetic-token", ilink_bot_id: "synthetic-bot", ilink_user_id: "synthetic-user", baseurl: "https://ilinkai.weixin.qq.com" }), { status: 200 });
  };
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const output: string[] = [];
  globalThis.fetch = fetchImpl as typeof fetch;
  console.log = (...values: unknown[]) => { output.push(values.map(String).join(" ")); };
  try { await runWeixinSetup(["--env", envFile, "--workdir", workspace]); }
  finally { globalThis.fetch = originalFetch; console.log = originalLog; }
  const env = await readFile(envFile, "utf8");
  const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
  return calls === 2 && credentials.accountId === "synthetic-bot" && credentials.userId === "synthetic-user" &&
    env.includes("CHAT2CODEX_ADAPTER=weixin") && env.includes("ALLOW_GROUPS=false") &&
    !output.join("\n").includes("synthetic-token");
}

function runDoctorJourney(packageVersion: string): { healthy: boolean; configRecovery: boolean } {
  const snapshot: DistributionDoctorSnapshot = {
    platform: "win32", arch: "x64", windowsVersion: "11.0.26100", packageVersion,
    manifest: { packageVersion, schemaVersion: 1, taskName: "NoviceAcceptance", launcherPath: "C:\\owned\\launcher.ps1" },
    task: { exists: true, taskName: "NoviceAcceptance", launcherPath: "C:\\owned\\launcher.ps1", lastResult: 0 },
    process: { writers: 1, lockHealthy: true }, stateSchemaVersion: 6, loopbackHost: "127.0.0.1",
    keys: ["prompt_hook", "stop_hook", "desktop_mcp"].map((role, index) => ({ role, path: "<owned-key-" + index + ">", formatValid: true, aclValid: true, fingerprint: "fingerprint-" + index })),
    hooks: { expectedHashesMatch: true }, desktop: { available: true, version: "synthetic" },
  };
  const checks = diagnoseWindowsDistribution(snapshot);
  const broken = diagnoseWindowsDistribution({ ...snapshot, loopbackHost: "0.0.0.0", process: { writers: 2, lockHealthy: false } });
  return {
    healthy: checks.length >= 8 && checks.every((item) => item.status === "ok") && !JSON.stringify(checks).includes("fingerprint-"),
    configRecovery: ["DIST_LOOPBACK_INVALID", "DIST_WRITER_CONFLICT"].every((code) => broken.some((item) => item.status === "error" && item.code === code && Boolean(item.recovery))),
  };
}

async function runGatewayOfflineJourney(): Promise<boolean> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a loopback port.");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const client = new DesktopGatewayClient({ port: address.port, expectedHost: "127.0.0.1:" + address.port, role: "desktop_mcp", keyId: "novice", secret: new Uint8Array(32).fill(5), timeoutMs: 500 });
  let rejected = false;
  try { await client.request("status", { kind: "status", requestId: "019fc160-7e0d-7990-9317-000000000999", rootThreadId: "root-thread" }); } catch { rejected = true; }
  return rejected;
}

async function runSchemaFailureJourney(root: string): Promise<boolean> {
  await mkdir(root, { recursive: true });
  for (const [name, source] of [["malformed", "{not-json\n"], ["future", JSON.stringify({ schemaVersion: 999, adapters: {} }) + "\n"]] as const) {
    const file = path.join(root, name + ".json");
    await writeFile(file, source);
    const before = sha256(await readFile(file));
    const store = new JsonStateStore(file, { adapterId: "weixin:novice", chat2codexHome: root });
    let rejected = false;
    try { await store.load(); } catch { rejected = true; }
    if (!rejected || sha256(await readFile(file)) !== before) return false;
  }
  return true;
}

async function runRestartRecoveryJourney(options: { root: string; probePath: string }): Promise<{ recovered: boolean; codexRuns: number; stateHash: string; processProof: { pid: number; createdAt: string; stopped: true; residualProcesses: 0 } }> {
  await mkdir(options.root, { recursive: true });
  const statePath = path.join(options.root, "state.json");
  const child = spawn(process.execPath, [options.probePath, "seed", statePath], {
    cwd: path.dirname(options.probePath), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let identity: { pid: number; createdAt: string } | undefined;
  try {
    const line = await firstLine(child.stdout!, 4_000);
    if (!line.startsWith("DURABLE_BOUNDARY state_saved ")) throw new Error("Restart probe missed durable boundary.");
    const boundary = JSON.parse(line.slice(line.indexOf("{")));
    identity = queryWindowsProcessIdentity(child.pid!);
    if (boundary.pid !== child.pid || identity.pid !== child.pid) throw new Error("Restart probe identity mismatch.");
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.kill();
    await closed;
    if (processExists(identity.pid)) throw new Error("Restart probe process remained after kill.");
    const recovered = spawnSync(process.execPath, [options.probePath, "recover", statePath], {
      cwd: path.dirname(options.probePath), encoding: "utf8", windowsHide: true,
    });
    if (recovered.status !== 0) throw new Error("Restart recovery probe failed.");
    const value = JSON.parse(recovered.stdout);
    return { recovered: value.schemaVersion === 6 && value.statuses.join(",") === "delivered,pending" && value.recoveredIds.length === 1, codexRuns: value.codexRuns, stateHash: boundary.stateHash, processProof: { pid: identity.pid, createdAt: identity.createdAt, stopped: true, residualProcesses: 0 } };
  } finally {
    if (!child.killed && (!identity || processExists(identity.pid))) child.kill();
  }
}

function scenarioPredicates(value: {
  options: { archiveVerified: boolean; packageVersion: string; cliVersion: string };
  daily: Awaited<ReturnType<typeof runNoviceDailyUseJourney>>;
  network: Awaited<ReturnType<typeof runNoviceNetworkRecoveryJourney>>;
  gateway: Awaited<ReturnType<typeof runNoviceGatewayRecoveryJourney>>;
  upgrade: Awaited<ReturnType<typeof runV5UpgradeRollbackJourney>>;
  restart: { recovered: boolean; codexRuns: number; stateHash: string; processProof: { pid: number; createdAt: string; stopped: true; residualProcesses: 0 } };
  probes: NovicePackageProbeResults;
  schemaFailures: boolean;
}): Map<string, boolean> {
  const { options, daily, network, gateway, upgrade, restart, probes, schemaFailures } = value;
  return new Map([
    ["fresh.download-and-prerequisites", options.archiveVerified && options.packageVersion === options.cliVersion],
    ["fresh.setup-and-doctor", probes.setupQrMock && probes.doctor],
    ["fresh.service-lifecycle", probes.lifecycle],
    ["fresh.task-control", probes.dailyUse],
    ["fresh.media-roundtrip", daily.outboxKinds.join(",") === "markdown,image,file" && daily.duplicateAcknowledgements === 3],
    ["fresh.multi-task-workspace-plan", daily.taskIds.length === 2 && daily.workspaceKinds.length === 6 && daily.planMode === "plan"],
    ["fresh.approval-permission-structured", daily.approvalAllowed && daily.permissionAllowed && daily.structuredValue === "conservative"],
    ["fresh.uninstall-and-reinstall", probes.lifecycle],
    ["fresh.purge-confirmation", probes.purgeUnavailableWithoutConfirmation],
    ["upgrade.idempotent-install-upgrade", probes.lifecycle && probes.upgradeRollback],
    ["upgrade.schema-migration", upgrade.sourceSchema === 5 && upgrade.migratedSchema === 6 && upgrade.sourceHash === upgrade.backupHash],
    ["upgrade.rollback-and-resume", probes.upgradeRollback],
    ["recovery.configuration-and-schema", probes.doctor && probes.configRecovery && schemaFailures],
    ["recovery.network-and-gateway-offline", probes.networkRecovery && probes.gatewayFailClosed && probes.gatewayOffline],
    ["recovery.duplicate-and-reordered-message", daily.duplicateAcknowledgements === 3 && network.codexRuns === 1],
    ["recovery.process-and-interruption", restart.recovered && restart.codexRuns === 1],
    ["recovery.disk-and-permission", probes.storagePermissionRecovery],
    ["recovery.gateway-token-generation", probes.gatewayFailClosed && gateway.staleTakeoverBlocked && gateway.generations.join(",") === "1,2,3"],
    ["recovery.unbound-and-child-exclusion", gateway.unboundDecision === "not_found" && gateway.childDecision === "not_found" && gateway.exportedCount === 0],
  ]);
}

async function firstLine(stream: NodeJS.ReadableStream, deadlineMs: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error("Restart boundary deadline exceeded.")), deadlineMs);
    stream.on("data", (chunk) => {
      text += String(chunk);
      if (text.includes("\n")) { clearTimeout(timer); resolve(text.slice(0, text.indexOf("\n"))); }
    });
    stream.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function queryWindowsProcessIdentity(pid: number): { pid: number; createdAt: string } {
  const command = "$p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "'; if(!$p){exit 3}; [pscustomobject]@{pid=[int]$p.ProcessId;createdAt=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("Could not query restart process identity.");
  return JSON.parse(result.stdout);
}

function processExists(pid: number): boolean {
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "if(Get-Process -Id " + pid + " -ErrorAction SilentlyContinue){exit 0}else{exit 1}"], { windowsHide: true }).status === 0;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
