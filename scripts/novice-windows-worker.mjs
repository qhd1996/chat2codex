import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const read = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const ownedRoot = path.resolve(read("--owned-root") ?? "");
const packageRoot = path.resolve(read("--package-root") ?? "");
const repetitions = Number(read("--repetitions") ?? "1");
if (!process.env.CHAT2CODEX_NOVICE_ISOLATION || !path.isAbsolute(ownedRoot) || !path.isAbsolute(packageRoot)) throw new Error("Novice package worker requires an isolated owned root and package root.");
const archiveSha256 = process.env.CHAT2CODEX_NOVICE_ARCHIVE_SHA256;
if (!/^[a-f0-9]{64}$/u.test(archiveSha256 ?? "")) throw new Error("Novice package worker requires a verified archive identity.");
if (repetitions !== 1 && repetitions !== 30) throw new Error("Novice package worker repetitions must be 1 or 30.");
if (!inside(ownedRoot, process.env.USERPROFILE) || !inside(ownedRoot, process.env.CODEX_HOME) || !inside(ownedRoot, process.env.CHAT2CODEX_HOME)) throw new Error("Novice package worker environment escaped the owned root.");
if (!inside(ownedRoot, packageRoot)) throw new Error("Novice package worker package escaped the owned root.");

const matrixUrl = new URL("../dist/quality/novice-package-matrix.js", import.meta.url);
const matrix = await import(matrixUrl.href);
if (!path.resolve(matrixUrl.pathname.replace(/^\/(?:[A-Za-z]:)/u, (value) => value.slice(1))).toLocaleLowerCase().startsWith(packageRoot.toLocaleLowerCase())) throw new Error("Novice worker imported outside the installed package.");
const workspace = path.join(ownedRoot, "worker"); await mkdir(workspace, { recursive: true });
const versionRun = spawnSync(process.execPath, [path.join(packageRoot, "dist", "index.js"), "--version"], { cwd: workspace, encoding: "utf8", windowsHide: true });
if (versionRun.status !== 0) throw new Error("Installed CLI version command failed.");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (versionRun.stdout.trim() !== packageJson.version) throw new Error("Installed CLI version differs from package.json.");

const records = [];
let product;
let probes;
let scenarioIds;
for (let index = 1; index <= repetitions; index += 1) {
  const startedAt = new Date().toISOString();
  const result = await matrix.runNovicePackageRepetition({
    root: path.join(workspace, "repetition-" + String(index).padStart(2, "0")),
    packageRoot,
    packageVersion: packageJson.version,
    cliVersion: versionRun.stdout.trim(),
    archiveVerified: true,
    restartProbePath: path.join(packageRoot, "scripts", "novice-restart-probe.mjs"),
  });
  product ??= result.product;
  probes ??= result.probes;
  scenarioIds ??= result.scenarioIds;
  if (JSON.stringify(result.probes) !== JSON.stringify(probes) || JSON.stringify(result.scenarioIds) !== JSON.stringify(scenarioIds)) throw new Error("Installed novice repetition coverage drifted.");
  records.push({
    index, seed: 2026080200 + index, startedAt, completedAt: new Date().toISOString(), verdict: "pass",
    counts: result.counts, scenarioIds: result.scenarioIds, stateHashes: result.stateHashes,
    commands: ["<installed-package>/scripts/novice-windows-worker.mjs --repetitions " + repetitions],
    processProof: result.processProof,
  });
}
const manifestHash = await hashTree(packageRoot);
const stateHash = records.at(-1).stateHashes.at(-1);
const evidence = {
  packageRoot, packageVersion: packageJson.version, archiveSha256, repositoryImported: false, cliVersion: versionRun.stdout.trim(),
  manifestHash, stateHash, taskCount: product.taskCount, outboxCount: product.outboxCount,
  networkRecovered: product.networkRecovered, gatewayFailClosed: product.gatewayFailClosed,
  migrationBackupExact: product.migrationBackupExact, nativeLifecycle: product.nativeLifecycle,
  probes, scenarioIds, repetitions: records,
};
process.stdout.write("NOVICE_PACKAGE_RESULT " + JSON.stringify(evidence) + "\n");

async function hashTree(root) { const entries = []; await collect(root, root, entries); const hash = createHash("sha256"); for (const file of entries.sort()) { hash.update(path.relative(root, file).replaceAll("\\", "/") + "\0"); hash.update(await readFile(file)); } return hash.digest("hex"); }
async function collect(root, current, output) { for (const entry of await readdir(current, { withFileTypes: true })) { const candidate = path.join(current, entry.name); if (entry.isSymbolicLink()) throw new Error("Installed package contains a symlink."); if (entry.isDirectory()) await collect(root, candidate, output); else if (entry.isFile()) output.push(candidate); } }
function inside(root, candidate) { if (!candidate) return false; const relative = path.relative(root, path.resolve(candidate)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
