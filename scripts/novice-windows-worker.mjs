import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const read = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const ownedRoot = path.resolve(read("--owned-root") ?? "");
const packageRoot = path.resolve(read("--package-root") ?? "");
if (!process.env.CHAT2CODEX_NOVICE_ISOLATION || !path.isAbsolute(ownedRoot) || !path.isAbsolute(packageRoot)) throw new Error("Novice package worker requires an isolated owned root and package root.");
if (!inside(ownedRoot, process.env.USERPROFILE) || !inside(ownedRoot, process.env.CODEX_HOME) || !inside(ownedRoot, process.env.CHAT2CODEX_HOME)) throw new Error("Novice package worker environment escaped the owned root.");
if (!inside(ownedRoot, packageRoot)) throw new Error("Novice package worker package escaped the owned root.");

const driverUrl = new URL("../dist/quality/novice-product-driver.js", import.meta.url);
const driver = await import(driverUrl.href);
if (!path.resolve(driverUrl.pathname.replace(/^\/(?:[A-Za-z]:)/u, (value) => value.slice(1))).toLocaleLowerCase().startsWith(packageRoot.toLocaleLowerCase())) throw new Error("Novice worker imported outside the installed package.");
const workspace = path.join(ownedRoot, "worker"); await mkdir(workspace, { recursive: true });
const versionRun = spawnSync(process.execPath, [path.join(packageRoot, "dist", "index.js"), "--version"], { cwd: workspace, encoding: "utf8", windowsHide: true });
if (versionRun.status !== 0) throw new Error("Installed CLI version command failed.");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (versionRun.stdout.trim() !== packageJson.version) throw new Error("Installed CLI version differs from package.json.");

const daily = await driver.runNoviceDailyUseJourney({ root: path.join(workspace, "daily") });
const network = await driver.runNoviceNetworkRecoveryJourney();
const gateway = await driver.runNoviceGatewayRecoveryJourney();
const upgrade = await driver.runV5UpgradeRollbackJourney({ root: path.join(workspace, "upgrade") });
const nativeRoot = path.join(workspace, "native");
const native = driver.validateFreshWindowsLifecycleResult(await driver.runFreshWindowsLifecycleJourney({ root: nativeRoot, seedState: "synthetic package state\n", stopAfterDoubleUninstall: true }));
const manifestHash = await hashTree(packageRoot);
const stateHash = upgrade.rollbackHash;
await rm(path.join(workspace, "daily"), { recursive: true, force: true });
const evidence = {
  packageRoot, packageVersion: packageJson.version, repositoryImported: false, cliVersion: versionRun.stdout.trim(),
  manifestHash, stateHash, taskCount: daily.taskIds.length, outboxCount: daily.deliveredIds.length,
  networkRecovered: network.allDelivered, gatewayFailClosed: gateway.wrongTokenCode === "invalid_signature" && gateway.unboundDecision === "not_found" && gateway.childDecision === "not_found",
  migrationBackupExact: upgrade.sourceHash === upgrade.backupHash && upgrade.rollbackHash === upgrade.sourceHash,
  nativeLifecycle: { installAttempts: native.installAttempts, uninstallAttempts: native.uninstallAttempts, keyCount: native.distinctKeyFingerprints, userDataPreserved: native.userDataPreserved, residualOwnedFiles: native.residualOwnedFiles.length },
};
process.stdout.write("NOVICE_PACKAGE_RESULT " + JSON.stringify(evidence) + "\n");

async function hashTree(root) { const entries = []; await collect(root, root, entries); const hash = createHash("sha256"); for (const file of entries.sort()) { hash.update(path.relative(root, file).replaceAll("\\", "/") + "\0"); hash.update(await readFile(file)); } return hash.digest("hex"); }
async function collect(root, current, output) { for (const entry of await readdir(current, { withFileTypes: true })) { const candidate = path.join(current, entry.name); if (entry.isSymbolicLink()) throw new Error("Installed package contains a symlink."); if (entry.isDirectory()) await collect(root, candidate, output); else if (entry.isFile()) output.push(candidate); } }
function inside(root, candidate) { if (!candidate) return false; const relative = path.relative(root, path.resolve(candidate)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
