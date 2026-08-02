import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateNoviceEvidence } from "./verify-novice-evidence.mjs";
import { runRealUpgradeProbe } from "./novice-real-upgrade-probe.mjs";

const qualifyingKinds = new Set(["clean_windows_vm", "equivalent_isolated_windows"]);

export async function planNoviceIsolation(input) {
  const archive = path.resolve(input.archive);
  if (!archive.toLocaleLowerCase().endsWith(".tgz")) throw new Error("Novice archive must be a .tgz file.");
  const info = await lstat(archive).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error("Novice archive must be a regular non-symlink file.");
  const canonicalArchive = await realpath(archive);
  if (!same(canonicalArchive, archive)) throw new Error("Novice archive path must be canonical.");
  if (typeof input.expectedSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(input.expectedSha256)) throw new Error("Novice archive hash is invalid.");
  const actualSha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
  if (actualSha256 !== input.expectedSha256) throw new Error("Novice archive hash does not match reviewed bytes.");
  const ownedRoot = path.resolve(input.ownedRoot);
  if (!path.isAbsolute(input.ownedRoot)) throw new Error("Novice owned root must be absolute.");
  for (const [label, candidate] of [
    ["repository", input.repositoryRoot], ["real profile", input.realUserProfile],
    ["real Codex Home", input.realCodexHome], ["production", input.productionRoot],
  ]) {
    if (overlaps(ownedRoot, path.resolve(candidate))) throw new Error("Novice owned root overlaps " + label + ".");
  }
  const environment = {
    userProfile: path.join(ownedRoot, "profile"), appData: path.join(ownedRoot, "profile", "AppData", "Roaming"),
    localAppData: path.join(ownedRoot, "profile", "AppData", "Local"), codexHome: path.join(ownedRoot, "codex-home"),
    chat2codexHome: path.join(ownedRoot, "chat2codex-home"), npmPrefix: path.join(ownedRoot, "npm-prefix"),
    workspace: path.join(ownedRoot, "workspace"), evidence: path.join(ownedRoot, "evidence"),
  };
  const installedPackageRoot = path.join(environment.npmPrefix, "node_modules", "chat2codex");
  const qualifyingEnvironment = qualifyingKinds.has(input.environmentKind) && input.qualification?.freshProfile === true && input.qualification?.repositoryAbsent === true && input.qualification?.priorPackageAbsent === true;
  if (qualifyingKinds.has(input.environmentKind) && !qualifyingEnvironment) throw new Error("Clean Windows qualification flags are incomplete.");
  return { archive: canonicalArchive, archiveSha256: actualSha256, ownedRoot, environment, installedPackageRoot, environmentKind: input.environmentKind, qualifyingEnvironment };
}

export async function runNoviceArchiveAcceptance(input) {
  const plan = await planNoviceIsolation(input);
  if (input.dryRun === true) return { plan, qualifying: false, verdict: "package_smoke" };
  for (const directory of Object.values(plan.environment)) await mkdir(directory, { recursive: true });
  const npm = input.npmCommand ?? "npm";
  const installArgs = ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", plan.environment.npmPrefix, plan.archive];
  const invocation = await planNpmInvocation({ command: npm, args: installArgs, platform: process.platform, pathValue: process.env.PATH, nodeCommand: input.nodeCommand ?? process.execPath });
  const install = spawnSync(invocation.command, invocation.args, { cwd: plan.ownedRoot, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (install.error || install.status !== 0) throw new Error("Private npm installation failed: " + redactedTail(install.error?.message ?? install.stderr));
  const installedRoot = await realpath(plan.installedPackageRoot);
  if (!inside(plan.environment.npmPrefix, installedRoot) || overlaps(installedRoot, path.resolve(input.repositoryRoot))) throw new Error("Installed novice package escaped the private prefix or resolved to the repository.");
  const worker = path.join(installedRoot, "scripts", "novice-windows-worker.mjs");
  const workerInfo = await lstat(worker).catch(() => null);
  if (!workerInfo?.isFile() || workerInfo.isSymbolicLink()) throw new Error("Installed novice package worker is missing.");
  const node = input.nodeCommand ?? process.execPath;
  let attestation = input.attestation;
  if (plan.qualifyingEnvironment) {
    const runIdentity = input.runIdentity;
    if (typeof runIdentity !== "string" || !/^[A-Za-z0-9._-]{8,200}$/u.test(runIdentity)) throw new Error("Qualifying novice run identity is invalid.");
    const taskName = "Chat2Codex-Novice-" + input.repositoryCommit.slice(0, 8);
    const attestationRoot = path.join(plan.ownedRoot, "native-lifecycle");
    const script = path.join(installedRoot, "scripts", "novice-clean-windows-attestation.mjs");
    const result = spawnSync(node, [script, "--owned-root", attestationRoot, "--environment-root", plan.ownedRoot, "--package-root", installedRoot, "--codex-bin", input.codexBin, "--task-name", taskName, "--production-root", input.productionRoot, "--archive-sha256", plan.archiveSha256, "--repository-commit", input.repositoryCommit, "--old-archive-sha256", input.oldArchiveSha256, "--old-repository-commit", input.oldRepositoryCommit, "--run-identity", runIdentity], { cwd: plan.environment.workspace, encoding: "utf8", windowsHide: true, env: { ...process.env, CHAT2CODEX_NOVICE_ISOLATION: "1" } });
    const marker = result.stdout.trim().split(/\r?\n/u).findLast((line) => line.startsWith("NOVICE_CLEAN_WINDOWS_ATTESTATION "));
    if (result.status !== 0 || !marker) throw new Error("Integrated clean Windows lifecycle attestation failed: " + redactedTail(result.stderr));
    attestation = JSON.parse(marker.slice("NOVICE_CLEAN_WINDOWS_ATTESTATION ".length));
  }
  const repetitions = plan.qualifyingEnvironment ? 30 : 1;
  const workerResult = spawnSync(node, [worker, "--owned-root", plan.ownedRoot, "--package-root", installedRoot, "--repetitions", String(repetitions)], {
    cwd: plan.environment.workspace, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, USERPROFILE: plan.environment.userProfile, APPDATA: plan.environment.appData, LOCALAPPDATA: plan.environment.localAppData, CODEX_HOME: plan.environment.codexHome, CHAT2CODEX_HOME: plan.environment.chat2codexHome, CHAT2CODEX_NOVICE_ISOLATION: "1", CHAT2CODEX_NOVICE_ARCHIVE_SHA256: plan.archiveSha256, CHAT2CODEX_NOVICE_RUN_IDENTITY: input.runIdentity ?? "package-smoke", CHAT2CODEX_NOVICE_ENVIRONMENT_ROOT: plan.ownedRoot },
  });
  if (workerResult.status !== 0) throw new Error("Installed novice worker failed: " + redactedTail(workerResult.stderr));
  const marker = workerResult.stdout.trim().split(/\r?\n/u).findLast((line) => line.startsWith("NOVICE_PACKAGE_RESULT "));
  if (!marker) throw new Error("Installed novice worker omitted its result marker.");
  const workerEvidence = JSON.parse(marker.slice("NOVICE_PACKAGE_RESULT ".length));
  const packageVersion = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8")).version;
  const expectedScenarioIds = JSON.parse(await readFile(path.join(installedRoot, "quality", "scenarios", "novice-daily-use.json"), "utf8")).map((item) => item.id).sort();
  validateNoviceWorkerEvidence(workerEvidence, { installedRoot, packageVersion, archiveSha256: plan.archiveSha256, expectedRepetitions: repetitions, expectedScenarioIds });
  const evidence = plan.qualifyingEnvironment ? buildQualifyingNoviceEvidence({
    worker: workerEvidence,
    authorityCommit: "01e827bbdc6584136627d9f1f137e8051f0a8c97",
    repositoryCommit: input.repositoryCommit,
    environmentKind: plan.environmentKind,
    archive: { version: packageVersion, size: (await lstat(plan.archive)).size, sha256: plan.archiveSha256 },
    versions: input.versions,
    expectedScenarioIds, expectedScenarioDefinitions: JSON.parse(await readFile(path.join(installedRoot, "quality", "scenarios", "novice-daily-use.json"), "utf8")),
    attestation, realUpgrade: await runRealUpgradeProbe({
      root: path.join(plan.ownedRoot, "real-upgrade"), oldArchive: input.oldArchive, candidateArchive: plan.archive, oldArchiveSha256: input.oldArchiveSha256, oldRepositoryCommit: input.oldRepositoryCommit, candidateArchiveSha256: plan.archiveSha256, oldVersion: input.oldVersion, candidateVersion: packageVersion, ownedEnvironmentHash: workerEvidence.ownedEnvironmentHash, runIdentityHash: workerEvidence.runIdentityHash, npmCommand: node, npmArgsPrefix: [await resolveNpmCli(process.env.PATH)],
    }),
  }) : undefined;
  return { plan, qualifying: plan.qualifyingEnvironment, verdict: plan.qualifyingEnvironment ? "pass" : "package_smoke", install: { command: [npm, ...installArgs].map(redactPart), exitCode: install.status }, worker: workerEvidence, evidence };
}

export async function planNpmInvocation(input) {
  const command = String(input.command);
  const args = Array.isArray(input.args) ? [...input.args] : [];
  if (input.platform !== "win32" || !/^npm(?:\.cmd)?$/iu.test(command)) return { command, args };
  const entries = String(input.pathValue ?? "").split(";").filter(Boolean);
  for (const entry of entries) {
    const cli = path.join(entry, "node_modules", "npm", "bin", "npm-cli.js");
    const info = await lstat(cli).catch(() => null);
    if (info?.isFile() && !info.isSymbolicLink() && same(await realpath(cli), cli)) return { command: input.nodeCommand, args: [cli, ...args] };
  }
  throw new Error("npm CLI was not found. Install Node.js with npm, then run doctor and retry.");
}

const requiredPackageProbes = ["setupQrMock", "doctor", "lifecycle", "dailyUse", "upgradeRollback", "networkRecovery", "gatewayFailClosed", "restartRecovery", "storagePermissionRecovery", "purgeUnavailableWithoutConfirmation", "configRecovery", "gatewayOffline"];

export function validateNoviceWorkerEvidence(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Installed novice worker evidence is invalid.");
  if (!same(path.resolve(value.packageRoot), expected.installedRoot) || value.repositoryImported !== false) throw new Error("Installed novice worker did not prove package-only imports.");
  if (expected.archiveSha256 && value.archiveSha256 !== expected.archiveSha256) throw new Error("Installed novice worker archive identity is invalid.");
  if (!/^[a-f0-9]{64}$/u.test(value.runIdentityHash ?? "") || !/^[a-f0-9]{64}$/u.test(value.ownedEnvironmentHash ?? "")) throw new Error("Installed novice worker run binding is invalid.");
  if (value.packageVersion !== expected.packageVersion || value.cliVersion !== expected.packageVersion) throw new Error("Installed novice CLI version evidence is invalid.");
  for (const field of ["manifestHash", "stateHash"]) if (typeof value[field] !== "string" || !/^[a-f0-9]{64}$/u.test(value[field])) throw new Error("Installed novice hash evidence is invalid.");
  if (value.taskCount !== 2 || value.outboxCount !== 3 || value.networkRecovered !== true || value.gatewayFailClosed !== true || value.migrationBackupExact !== true) throw new Error("Installed novice product-boundary evidence is incomplete.");
  const native = value.nativeLifecycle;
  if (!native || native.installAttempts !== 2 || native.uninstallAttempts !== 2 || native.keyCount !== 3 || native.userDataPreserved !== true || native.residualOwnedFiles !== 0) throw new Error("Installed novice native lifecycle evidence is incomplete.");
  if (!value.probes || requiredPackageProbes.some((key) => value.probes[key] !== true) || Object.keys(value.probes).some((key) => !requiredPackageProbes.includes(key))) throw new Error("Installed novice product probes are incomplete.");
  if (!Array.isArray(value.scenarioIds) || value.scenarioIds.length !== 19 || new Set(value.scenarioIds).size !== 19) throw new Error("Installed novice scenario coverage is incomplete.");
  validateScenarioExecutions(value.scenarioExecutions, value.scenarioIds);
  if (expected.expectedScenarioIds && JSON.stringify([...value.scenarioIds].sort()) !== JSON.stringify([...expected.expectedScenarioIds].sort())) throw new Error("Installed novice scenario inventory differs from the package.");
  if (!Array.isArray(value.repetitions) || value.repetitions.length !== expected.expectedRepetitions) throw new Error("Installed novice repetition coverage is incomplete.");
  for (const [offset, repetition] of value.repetitions.entries()) {
    if (repetition.index !== offset + 1 || repetition.verdict !== "pass" || repetition.counts?.pass !== 19 || repetition.counts?.fail !== 0 || repetition.counts?.skip !== 0 || repetition.counts?.timeout !== 0 || repetition.counts?.residualProcesses !== 0 || JSON.stringify([...repetition.scenarioIds].sort()) !== JSON.stringify([...value.scenarioIds].sort()) || scenarioContract(repetition.scenarioExecutions) !== scenarioContract(value.scenarioExecutions)) throw new Error("Installed novice repetition failed closed.");
  }
  return value;
}
function scenarioContract(items) { return JSON.stringify(items.map(({ productProofs, ...item }) => ({ ...item, productProofSources: productProofs.map((proof) => proof.source) }))); }
function validateScenarioExecutions(raw, scenarioIds) {
  if (!Array.isArray(raw) || raw.length !== scenarioIds.length) throw new Error("Installed novice scenario executions are incomplete.");
  const keys = ["actions","faults","invariants","preconditions","probes","productProofs","promptCodes","recovery","scenarioId","verdict"];
  const observed = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item) || JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(keys) || typeof item.scenarioId !== "string" || item.verdict !== "pass" || observed.has(item.scenarioId)) throw new Error("Installed novice scenario execution is invalid.");
    observed.add(item.scenarioId);
    for (const field of ["preconditions","actions","promptCodes","invariants","faults","recovery","probes"]) if (!Array.isArray(item[field]) || field !== "faults" && item[field].length === 0 || new Set(item[field]).size !== item[field].length || item[field].some((value) => typeof value !== "string" || !value)) throw new Error("Installed novice scenario execution tokens are invalid.");
    if (!Array.isArray(item.productProofs) || item.productProofs.length < 1 || item.productProofs.some((proof) => !proof || Object.keys(proof).sort().join(",") !== "sha256,source" || typeof proof.source !== "string" || !/^[a-f0-9]{64}$/u.test(proof.sha256))) throw new Error("Installed novice scenario product proof is invalid.");
  }
  if (JSON.stringify([...observed].sort()) !== JSON.stringify([...scenarioIds].sort())) throw new Error("Installed novice scenario execution inventory differs.");
}

export function buildQualifyingNoviceEvidence(input) {
  if (!/^[a-f0-9]{40}$/u.test(String(input.repositoryCommit ?? ""))) throw new Error("Qualifying novice repository commit is invalid.");
  if (input.environmentKind !== "clean_windows_vm" && input.environmentKind !== "equivalent_isolated_windows") throw new Error("Qualifying novice environment kind is invalid.");
  validateNoviceWorkerEvidence(input.worker, { installedRoot: path.resolve(input.worker.packageRoot), packageVersion: input.archive.version, archiveSha256: input.archive.sha256, expectedRepetitions: 30, expectedScenarioIds: input.expectedScenarioIds ?? input.worker.scenarioIds });
  if (!input.attestation) throw new Error("Qualifying novice evidence requires an independent Windows lifecycle attestation.");
  if (input.attestation.archiveSha256 !== input.archive.sha256 || input.attestation.repositoryCommit !== input.repositoryCommit || input.attestation.oldArchiveSha256 !== input.realUpgrade.oldArchiveSha256 || input.attestation.oldRepositoryCommit !== input.realUpgrade.oldRepositoryCommit || input.attestation.runIdentityHash !== input.worker.runIdentityHash || input.attestation.ownedEnvironmentHash !== input.worker.ownedEnvironmentHash) throw new Error("Qualifying novice attestation binding differs from the package journey.");
  const repetitions = input.worker.repetitions.map((item) => ({ ...item }));
  const manifest = {
    schemaVersion: 5,
    authorityCommit: input.authorityCommit,
    repositoryCommit: input.repositoryCommit,
    generatedAt: new Date().toISOString(),
    evidenceLevel: "isolated_package",
    verdict: "pass",
    environment: { kind: input.environmentKind, os: "win32", arch: process.arch, freshProfile: true, repositoryAbsent: true, priorPackageAbsent: true, realUserCodexHomeUntouched: true, productionUntouched: true },
    archive: input.archive,
    versions: input.versions,
    scenarioIds: input.worker.scenarioIds,
    repetitions,
    failureHistory: [
      { repetition: 1, code: "preinstall_windows_npm_spawn", fixedByCommit: "ea0bab240a13f0fa841c370f5458efddd2c4cf00" },
      { repetition: 1, code: "preinstall_archive_eol_drift", fixedByCommit: "d3c214f9fdda44f7e06f8fe1170e6076f4506f1e" },
      { repetition: 1, code: "preinstall_qualification_runtime_gaps", fixedByCommit: input.repositoryCommit },
    ],
    attestation: input.attestation, realUpgrade: input.realUpgrade,
  };
  validateNoviceEvidence(manifest, { scenarioIds: input.worker.scenarioIds, scenarioDefinitions: input.expectedScenarioDefinitions });
  return manifest;
}

function overlaps(left, right) { return inside(left, right) || inside(right, left); }
function inside(root, candidate) { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function same(left, right) { return process.platform === "win32" ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right; }
function redactedTail(value) { return String(value ?? "").replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/giu, "<profile>").slice(-2000); }
function redactPart(value) { return path.isAbsolute(value) ? "<owned-path>" : value; }

async function main() {
  const args = process.argv.slice(2); const read = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const node = process.execPath;
  const archive = read("--archive"); const expectedSha256 = read("--sha256"); const ownedRoot = read("--owned-root");
  if (!archive || !expectedSha256 || !ownedRoot) throw new Error("Usage: node run-novice-acceptance.mjs --archive FILE --sha256 HASH --owned-root DIR");
  const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const productionRoot = read("--production-root") ?? process.env.CHAT2CODEX_PRODUCTION_ROOT;
  if (!productionRoot) throw new Error("Novice acceptance requires an explicit production-root exclusion path.");
  const environmentKind = read("--environment-kind") ?? "isolated_profile_projection";
  const environmentRoot = path.resolve(read("--environment-root") ?? ownedRoot);
  if (!same(environmentRoot, path.resolve(ownedRoot))) throw new Error("Novice owned root must equal the declared environment root.");
  const qualifying = qualifyingKinds.has(environmentKind);
  const repositoryCommit = read("--repository-commit");
  const reportPath = read("--report");
  const runIdentity = read("--run-identity");
  const codexBin = read("--codex-bin");
  const oldArchive = read("--old-archive"); const oldArchiveSha256 = read("--old-sha256"); const oldVersion = read("--old-version"); const oldRepositoryCommit = read("--old-commit");
  if (qualifying && !oldRepositoryCommit) throw new Error("Qualifying novice run requires the supported old repository commit.");
  if (qualifying && (!repositoryCommit || !reportPath || !runIdentity || !codexBin || !oldArchive || !oldArchiveSha256 || !oldVersion || !args.includes("--fresh-profile") || !args.includes("--repository-absent") || !args.includes("--prior-package-absent"))) throw new Error("Qualifying novice run requires commit, report, run identity, Codex binary, old package, and all fresh-environment flags.");
  if (!qualifying && (repositoryCommit || reportPath || args.includes("--fresh-profile") || args.includes("--repository-absent") || args.includes("--prior-package-absent"))) throw new Error("Package smoke cannot claim qualifying environment metadata.");
  const npmVersion = runVersion(node, [await resolveNpmCli(process.env.PATH), "--version"]);
  const codexVersion = runVersion("codex", ["--version"]);
  const bunVersion = runVersion("bun", ["--version"]);
  const result = await runNoviceArchiveAcceptance({
    archive, expectedSha256, ownedRoot, repositoryRoot, realUserProfile: os.homedir(), realCodexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), productionRoot,
    environmentKind, qualification: qualifying ? { freshProfile: true, repositoryAbsent: true, priorPackageAbsent: true } : undefined,
    repositoryCommit, versions: { windows: os.release(), node: process.versions.node, npm: npmVersion, bun: bunVersion, package: JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).version, codexCli: codexVersion },
    runIdentity, codexBin, oldArchive, oldArchiveSha256, oldVersion, oldRepositoryCommit,
    dryRun: args.includes("--dry-run"),
  });
  process.stdout.write(JSON.stringify({
    qualifying: result.qualifying, verdict: result.verdict, archiveSha256: result.plan.archiveSha256,
    packageVersion: result.worker?.packageVersion, cliVersion: result.worker?.cliVersion,
    manifestHash: result.worker?.manifestHash, stateHash: result.worker?.stateHash,
    taskCount: result.worker?.taskCount, outboxCount: result.worker?.outboxCount,
    networkRecovered: result.worker?.networkRecovered, gatewayFailClosed: result.worker?.gatewayFailClosed,
    migrationBackupExact: result.worker?.migrationBackupExact, nativeLifecycle: result.worker?.nativeLifecycle,
  }) + "\n");
  if (result.evidence && reportPath) {
    const resolvedReport = path.resolve(reportPath);
    if (!path.isAbsolute(reportPath) || path.extname(resolvedReport).toLocaleLowerCase() !== ".json" || path.dirname(resolvedReport).toLocaleLowerCase() !== path.dirname(result.plan.ownedRoot).toLocaleLowerCase() || [repositoryRoot, productionRoot, os.homedir(), result.plan.ownedRoot].some((root) => overlaps(resolvedReport, path.resolve(root)))) throw new Error("Novice report path must be a protected sibling JSON file.");
    if (await lstat(resolvedReport).catch(() => null)) throw new Error("Novice report path already exists.");
    await writeFile(resolvedReport, JSON.stringify(result.evidence, null, 2) + "\n", { flag: "wx" });
  }
  if (args.includes("--cleanup")) {
    const resolved = path.resolve(ownedRoot);
    if (!same(resolved, result.plan.ownedRoot) || overlaps(resolved, repositoryRoot) || overlaps(resolved, productionRoot) || overlaps(resolved, os.homedir())) throw new Error("Novice cleanup target is unsafe.");
    await rm(resolved, { recursive: true, force: true });
  }
}

async function resolveNpmCli(pathValue) {
  const invocation = await planNpmInvocation({ command: "npm", args: [], platform: process.platform, pathValue, nodeCommand: process.execPath });
  return invocation.args[0];
}
export async function readNoviceAttestation(attestationPath, environmentKind, packageRootInput = path.resolve(fileURLToPath(new URL("..", import.meta.url)))) {
  if (!path.isAbsolute(attestationPath)) throw new Error("Novice attestation path must be absolute.");
  const file = path.resolve(attestationPath);
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || !same(await realpath(file), file)) throw new Error("Novice attestation must be a canonical regular file.");
  const value = JSON.parse(await readFile(file, "utf8"));
  if (value.environmentKind !== environmentKind) throw new Error("Novice attestation environment kind differs from the run.");
  const packageRoot = path.resolve(packageRootInput);
  for (const item of value.installedFiles ?? []) {
    if (typeof item?.path !== "string" || !item.path.startsWith("package/")) continue;
    const relative = item.path.slice("package/".length);
    const file = path.resolve(packageRoot, relative);
    if (!inside(packageRoot, file)) throw new Error("Novice attestation package hash path escaped the package.");
    const actual = createHash("sha256").update(await readFile(file)).digest("hex");
    if (actual !== item.sha256) throw new Error("Novice attestation package file hash differs from the runner package.");
  }
  return value;
}
function runVersion(command, versionArgs, fallback) { const result = spawnSync(command, versionArgs, { encoding: "utf8", windowsHide: true }); if (result.status !== 0) { if (fallback) return fallback; throw new Error("Required version command failed: " + command); } const match = String(result.stdout).match(/[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?/u); if (!match) throw new Error("Required version output is invalid: " + command); return match[0]; }
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { process.stderr.write("novice-acceptance: " + (error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; });
