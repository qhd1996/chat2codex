import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const workerResult = spawnSync(node, [worker, "--owned-root", plan.ownedRoot, "--package-root", installedRoot], {
    cwd: plan.environment.workspace, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, USERPROFILE: plan.environment.userProfile, APPDATA: plan.environment.appData, LOCALAPPDATA: plan.environment.localAppData, CODEX_HOME: plan.environment.codexHome, CHAT2CODEX_HOME: plan.environment.chat2codexHome, CHAT2CODEX_NOVICE_ISOLATION: "1" },
  });
  if (workerResult.status !== 0) throw new Error("Installed novice worker failed: " + redactedTail(workerResult.stderr));
  const marker = workerResult.stdout.trim().split(/\r?\n/u).findLast((line) => line.startsWith("NOVICE_PACKAGE_RESULT "));
  if (!marker) throw new Error("Installed novice worker omitted its result marker.");
  const workerEvidence = JSON.parse(marker.slice("NOVICE_PACKAGE_RESULT ".length));
  validateNoviceWorkerEvidence(workerEvidence, { installedRoot, packageVersion: JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8")).version });
  return { plan, qualifying: plan.qualifyingEnvironment, verdict: plan.qualifyingEnvironment ? "pass" : "package_smoke", install: { command: [npm, ...installArgs].map(redactPart), exitCode: install.status }, worker: workerEvidence };
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

export function validateNoviceWorkerEvidence(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Installed novice worker evidence is invalid.");
  if (!same(path.resolve(value.packageRoot), expected.installedRoot) || value.repositoryImported !== false) throw new Error("Installed novice worker did not prove package-only imports.");
  if (value.packageVersion !== expected.packageVersion || value.cliVersion !== expected.packageVersion) throw new Error("Installed novice CLI version evidence is invalid.");
  for (const field of ["manifestHash", "stateHash"]) if (typeof value[field] !== "string" || !/^[a-f0-9]{64}$/u.test(value[field])) throw new Error("Installed novice hash evidence is invalid.");
  if (value.taskCount !== 2 || value.outboxCount !== 3 || value.networkRecovered !== true || value.gatewayFailClosed !== true || value.migrationBackupExact !== true) throw new Error("Installed novice product-boundary evidence is incomplete.");
  const native = value.nativeLifecycle;
  if (!native || native.installAttempts !== 2 || native.uninstallAttempts !== 2 || native.keyCount !== 3 || native.userDataPreserved !== true || native.residualOwnedFiles !== 0) throw new Error("Installed novice native lifecycle evidence is incomplete.");
  return value;
}

function overlaps(left, right) { return inside(left, right) || inside(right, left); }
function inside(root, candidate) { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function same(left, right) { return process.platform === "win32" ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right; }
function redactedTail(value) { return String(value ?? "").replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/giu, "<profile>").slice(-2000); }
function redactPart(value) { return path.isAbsolute(value) ? "<owned-path>" : value; }

async function main() {
  const args = process.argv.slice(2); const read = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const archive = read("--archive"); const expectedSha256 = read("--sha256"); const ownedRoot = read("--owned-root");
  if (!archive || !expectedSha256 || !ownedRoot) throw new Error("Usage: node run-novice-acceptance.mjs --archive FILE --sha256 HASH --owned-root DIR");
  const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const productionRoot = read("--production-root") ?? process.env.CHAT2CODEX_PRODUCTION_ROOT;
  if (!productionRoot) throw new Error("Novice acceptance requires an explicit production-root exclusion path.");
  const result = await runNoviceArchiveAcceptance({ archive, expectedSha256, ownedRoot, repositoryRoot, realUserProfile: os.homedir(), realCodexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), productionRoot, environmentKind: read("--environment-kind") ?? "isolated_profile_projection", dryRun: args.includes("--dry-run") });
  process.stdout.write(JSON.stringify({
    qualifying: result.qualifying, verdict: result.verdict, archiveSha256: result.plan.archiveSha256,
    packageVersion: result.worker?.packageVersion, cliVersion: result.worker?.cliVersion,
    manifestHash: result.worker?.manifestHash, stateHash: result.worker?.stateHash,
    taskCount: result.worker?.taskCount, outboxCount: result.worker?.outboxCount,
    networkRecovered: result.worker?.networkRecovered, gatewayFailClosed: result.worker?.gatewayFailClosed,
    migrationBackupExact: result.worker?.migrationBackupExact, nativeLifecycle: result.worker?.nativeLifecycle,
  }) + "\n");
  if (args.includes("--cleanup")) {
    const resolved = path.resolve(ownedRoot);
    if (!same(resolved, result.plan.ownedRoot) || overlaps(resolved, repositoryRoot) || overlaps(resolved, productionRoot) || overlaps(resolved, os.homedir())) throw new Error("Novice cleanup target is unsafe.");
    await rm(resolved, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { process.stderr.write("novice-acceptance: " + (error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; });
