import { lstat, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRealUpgradeEvidence } from "./novice-real-upgrade-probe.mjs";

const authorityCommit = "01e827bbdc6584136627d9f1f137e8051f0a8c97";
const manifestKeys = ["archive", "attestation", "authorityCommit", "environment", "evidenceLevel", "failureHistory", "generatedAt", "realUpgrade", "repetitions", "repositoryCommit", "scenarioIds", "schemaVersion", "verdict", "versions"];
const environmentKeys = ["arch", "freshProfile", "kind", "os", "priorPackageAbsent", "productionUntouched", "realUserCodexHomeUntouched", "repositoryAbsent"];
const archiveKeys = ["sha256", "size", "version"];
const versionKeys = ["bun", "codexCli", "node", "npm", "package", "windows"];
const repetitionKeys = ["commands", "completedAt", "counts", "index", "processProof", "scenarioExecutions", "scenarioIds", "seed", "startedAt", "stateHashes", "verdict"];
const countKeys = ["fail", "pass", "residualProcesses", "skip", "timeout"];
const historyKeys = ["code", "fixedByCommit", "repetition"];
const processProofKeys = ["createdAt", "pid", "residualProcesses", "stopped"];
const attestationKeys = ["anotherInteractiveUserDenied", "archiveSha256", "attestationHash", "commands", "doctorExitCode", "environmentKind", "firstProcess", "freshProfile", "githubActions", "installAttempts", "installedFiles", "lockHealthy", "newKeysAfterReinstall", "oldArchiveSha256", "oldRepositoryCommit", "ownedEnvironmentHash", "ownedRootRemoved", "priorPackageAbsent", "productionUntouched", "realUserCodexHomeUntouched", "repositoryAbsent", "repositoryCommit", "runIdentityHash", "runnerEnvironment", "secondProcess", "singleWriter", "startAttempts", "stopAttempts", "taskNameHash", "taskRemoved", "uninstallAttempts", "userDataPreserved", "zeroResidualProcesses"];
const attestationProcessKeys = ["commandHash", "createdAt", "pid", "stateSha256"];
const installedFileKeys = ["path", "sha256"];

export function validateNoviceEvidence(value, options) {
  const manifest = object(value, "manifest"); exactKeys(manifest, manifestKeys, "manifest");
  if (manifest.schemaVersion !== 4) throw new Error("Novice evidence schema version is unsupported.");
  if (manifest.authorityCommit !== authorityCommit) throw new Error("Novice evidence authority commit is invalid.");
  commit(manifest.repositoryCommit, "repository commit"); timestamp(manifest.generatedAt, "generatedAt");
  if (manifest.evidenceLevel !== "repository" && manifest.evidenceLevel !== "isolated_package") throw new Error("Novice evidence level is invalid.");
  if (manifest.verdict !== "unproven" && manifest.verdict !== "repository_pass" && manifest.verdict !== "pass") throw new Error("Novice evidence verdict is invalid.");
  const expectedScenarioIds = uniqueStrings(options?.scenarioIds, "expected scenario IDs").sort();
  const expectedScenarioExecutions = buildExpectedScenarioExecutions(options?.scenarioDefinitions);
  if (manifest.verdict === "unproven") {
    if (!Array.isArray(manifest.repetitions) || manifest.repetitions.length !== 0) throw new Error("Unproven novice template cannot contain repetitions.");
    if (!Array.isArray(manifest.scenarioIds) || manifest.scenarioIds.length !== 0) throw new Error("Unproven novice template cannot claim scenario coverage.");
    validateEnvironment(manifest.environment, false); validateArchive(manifest.archive, false); validateVersions(manifest.versions);
    if (!Array.isArray(manifest.failureHistory) || manifest.attestation !== null || manifest.realUpgrade !== null) throw new Error("Unproven novice evidence cannot contain Windows or real-upgrade evidence.");
    assertNoviceOutputSafe(manifest);
    return { qualifying: false, repetitions: 0, scenarios: expectedScenarioIds.length, verdict: "unproven" };
  }
  const qualifying = manifest.verdict === "pass";
  if (qualifying && manifest.evidenceLevel !== "isolated_package") throw new Error("A qualifying novice pass requires isolated_package evidence.");
  if (!qualifying && manifest.evidenceLevel !== "repository") throw new Error("A repository novice pass requires repository evidence.");
  validateEnvironment(manifest.environment, qualifying); validateArchive(manifest.archive, qualifying); validateVersions(manifest.versions);
  const topScenarios = uniqueStrings(manifest.scenarioIds, "scenario IDs").sort();
  if (JSON.stringify(topScenarios) !== JSON.stringify(expectedScenarioIds)) throw new Error("Novice evidence scenario inventory does not match the required scenarios.");
  if (!Array.isArray(manifest.repetitions) || manifest.repetitions.length !== 30) throw new Error("Novice evidence requires exactly 30 repetitions.");
  for (const [offset, raw] of manifest.repetitions.entries()) { validateScenarioExecutionEvidence(raw?.scenarioExecutions, expectedScenarioExecutions); validateRepetition(raw, offset + 1, expectedScenarioIds, qualifying); }
  validateFailureHistory(manifest.failureHistory);
  if (qualifying) {
    const binding = object(manifest.attestation, "attestation");
    if (binding.archiveSha256 !== manifest.archive.sha256 || binding.repositoryCommit !== manifest.repositoryCommit || binding.oldArchiveSha256 !== manifest.realUpgrade?.oldArchiveSha256 || binding.oldRepositoryCommit !== manifest.realUpgrade?.oldRepositoryCommit) throw new Error("Novice attestation binding differs from the candidate or old archive/commit.");
    hash(binding.runIdentityHash, "attestation run identity"); hash(binding.ownedEnvironmentHash, "attestation owned environment");
    validateRealUpgradeEvidence(manifest.realUpgrade, { oldArchiveSha256: binding.oldArchiveSha256, oldRepositoryCommit: binding.oldRepositoryCommit, candidateArchiveSha256: manifest.archive.sha256, oldVersion: "0.8.0-orchestrator.4", candidateVersion: manifest.archive.version, ownedEnvironmentHash: binding.ownedEnvironmentHash, runIdentityHash: binding.runIdentityHash });
  }
  if (qualifying) { const identities=new Set(manifest.repetitions.map((item)=>item.processProof.pid+"|"+item.processProof.createdAt)); if(identities.size!==30) throw new Error("Qualifying novice process proofs must be unique for all repetitions."); if(!manifest.failureHistory.length||manifest.failureHistory.some((item)=>item.fixedByCommit===null)) throw new Error("Qualifying novice evidence must retain fixed failure history."); validateAttestation(manifest.attestation, manifest); } else if (manifest.attestation !== null || manifest.realUpgrade !== null) throw new Error("Repository novice evidence cannot contain qualifying Windows or real-upgrade evidence.");
  assertNoviceOutputSafe(manifest);
  return { qualifying, repetitions: 30, scenarios: expectedScenarioIds.length, verdict: manifest.verdict };
}

function validateEnvironment(raw, qualifying) {
  const value = object(raw, "environment"); exactKeys(value, environmentKeys, "environment");
  if (value.os !== "win32" || typeof value.arch !== "string") throw new Error("Novice evidence environment is not Windows.");
  for (const key of ["freshProfile", "repositoryAbsent", "priorPackageAbsent", "realUserCodexHomeUntouched", "productionUntouched"]) if (typeof value[key] !== "boolean") throw new Error("Novice evidence environment flag is invalid.");
  if (qualifying && (value.kind !== "clean_windows_vm" && value.kind !== "equivalent_isolated_windows")) throw new Error("Qualifying novice evidence requires a clean isolated Windows environment.");
  if (qualifying && ["freshProfile", "repositoryAbsent", "priorPackageAbsent", "realUserCodexHomeUntouched", "productionUntouched"].some((key) => value[key] !== true)) throw new Error("Qualifying novice evidence requires a fresh profile and untouched production/Codex Home.");
}
function validateArchive(raw, qualifying) { const value = object(raw, "archive"); exactKeys(value, archiveKeys, "archive"); version(value.version, "archive version"); if (!Number.isSafeInteger(value.size) || value.size < (qualifying ? 1 : 0)) throw new Error("Novice archive size is invalid."); if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sha256) || qualifying && /^0+$/u.test(value.sha256)) throw new Error("Novice archive hash is invalid."); }
function validateVersions(raw) { const value = object(raw, "versions"); exactKeys(value, versionKeys, "versions"); for (const [key, item] of Object.entries(value)) version(item, key + " version"); }
function validateRepetition(raw, expectedIndex, expectedScenarioIds, qualifying) { const value = object(raw, "repetition"); exactKeys(value, repetitionKeys, "repetition"); if (value.index !== expectedIndex) throw new Error("Novice repetition index is not consecutive."); if (!Number.isSafeInteger(value.seed)) throw new Error("Missing novice repetition seed."); timestamp(value.startedAt, "startedAt"); timestamp(value.completedAt, "completedAt"); if (value.verdict !== "pass") throw new Error("Novice repetition did not pass."); const counts = object(value.counts, "counts"); exactKeys(counts, countKeys, "counts"); for (const [key, count] of Object.entries(counts)) if (!Number.isSafeInteger(count) || count < 0) throw new Error("Novice repetition count is invalid: " + key); if (counts.fail !== 0 || counts.skip !== 0 || counts.timeout !== 0 || counts.residualProcesses !== 0) throw new Error("Novice repetition requires zero fail, skip, timeout, and residual counts."); if (counts.pass < expectedScenarioIds.length) throw new Error("Novice repetition pass count is incomplete."); const scenarios = uniqueStrings(value.scenarioIds, "repetition scenario IDs").sort(); if (JSON.stringify(scenarios) !== JSON.stringify(expectedScenarioIds)) throw new Error("Novice repetition scenario coverage is incomplete."); const hashes = uniqueStrings(value.stateHashes, "state hashes"); if (hashes.length === 0 || hashes.some((hash) => !/^[a-f0-9]{64}$/u.test(hash))) throw new Error("Novice repetition state hash is invalid."); const commands = uniqueStrings(value.commands, "commands"); if (commands.length === 0 || commands.some((command) => command.length > 1000)) throw new Error("Novice repetition command evidence is invalid."); if (qualifying) validateProcessProof(value.processProof); else if (value.processProof !== null) throw new Error("Repository repetition process proof must remain null."); }
function validateProcessProof(raw) { const value = object(raw, "process proof"); exactKeys(value, processProofKeys, "process proof"); if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || value.stopped !== true || value.residualProcesses !== 0) throw new Error("Novice process proof requires a stopped process and zero residuals."); timestamp(value.createdAt, "process createdAt"); }
function validateAttestation(raw) { const value = object(raw, "attestation"); exactKeys(value, attestationKeys, "attestation"); const expectedHash = value.attestationHash; const hashInput = { ...value }; delete hashInput.attestationHash; if (typeof expectedHash !== "string" || expectedHash !== createHash("sha256").update(JSON.stringify(hashInput)).digest("hex")) throw new Error("Novice attestation hash is invalid."); if ((value.environmentKind !== "clean_windows_vm" && value.environmentKind !== "equivalent_isolated_windows") || value.githubActions !== true || value.runnerEnvironment !== "github-hosted" || value.freshProfile !== true || value.repositoryAbsent !== true || value.priorPackageAbsent !== true || value.realUserCodexHomeUntouched !== true || value.productionUntouched !== true) throw new Error("Novice attestation environment is not qualifying."); for (const [key, expected] of [["installAttempts",3],["startAttempts",2],["stopAttempts",2],["uninstallAttempts",3],["doctorExitCode",0]]) if (value[key] !== expected) throw new Error("Novice attestation lifecycle count is invalid."); for (const key of ["singleWriter","lockHealthy","userDataPreserved","taskRemoved","newKeysAfterReinstall","anotherInteractiveUserDenied","zeroResidualProcesses","ownedRootRemoved"]) if (value[key] !== true) throw new Error("Novice attestation lifecycle boundary is incomplete."); hash(value.taskNameHash, "attestation task name"); const first = validateAttestationProcess(value.firstProcess); const second = validateAttestationProcess(value.secondProcess); if (first.pid === second.pid && first.createdAt === second.createdAt) throw new Error("Novice attestation restart did not rotate process identity."); if(first.stateSha256!==second.stateSha256) throw new Error("Novice attestation state changed across restart."); const files = value.installedFiles; if (!Array.isArray(files) || files.length < 8 || files.length > 64) throw new Error("Novice installed file hashes are incomplete."); const paths = new Set(); for (const rawFile of files) { const file = object(rawFile,"installed file"); exactKeys(file,installedFileKeys,"installed file"); if (typeof file.path !== "string" || !/^(?:package|owned)\/[A-Za-z0-9._/-]+$/u.test(file.path) || file.path.includes("..") || paths.has(file.path)) throw new Error("Novice installed file path is invalid."); paths.add(file.path); hash(file.sha256,"installed file"); } for(const required of ["package/package.json","package/dist/index.js","package/scripts/novice-service-probe.mjs","owned/.env","owned/.service/windows/launcher.ps1","owned/.service/windows/task.xml","owned/.service/windows/installation.json","owned/.data/state.json"]) if(!paths.has(required)) throw new Error("Novice required installed file hash is missing."); const commands = strings(value.commands,"attestation commands"); if (commands.length < 8) throw new Error("Novice attestation commands are incomplete."); }
function validateAttestationProcess(raw) { const value=object(raw,"attestation process"); exactKeys(value,attestationProcessKeys,"attestation process"); if(!Number.isSafeInteger(value.pid)||value.pid<=0) throw new Error("Novice attestation process identity is invalid."); timestamp(value.createdAt,"attestation process createdAt"); hash(value.commandHash,"attestation process command"); hash(value.stateSha256,"attestation process state"); return value; }
function hash(value,label) { if(typeof value!=="string"||!/^[a-f0-9]{64}$/u.test(value)) throw new Error("Novice "+label+" hash is invalid."); }
function validateFailureHistory(raw) { if (!Array.isArray(raw) || raw.length > 256) throw new Error("Novice failure history is invalid."); for (const itemRaw of raw) { const item = object(itemRaw, "failure history"); exactKeys(item, historyKeys, "failure history"); if (!Number.isSafeInteger(item.repetition) || item.repetition < 1 || item.repetition > 30 || typeof item.code !== "string" || item.code.length < 1 || item.code.length > 160 || item.fixedByCommit !== null && (typeof item.fixedByCommit !== "string" || !/^[a-f0-9]{40}$/u.test(item.fixedByCommit))) throw new Error("Novice failure history record is invalid."); } }
function assertNoviceOutputSafe(value) { let source; try { source = JSON.stringify(value); } catch { throw new Error("Novice evidence is not safely serializable."); } if (/(?:Bearer[ \t]+[A-Za-z0-9._~+/-]{20,}|novice-secret-canary-|prompt-canary[ \t]*:|identity-canary(?:@|:)|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/iu.test(source)) throw new Error("Novice evidence contains sensitive unredacted output."); const rawStrings = []; collectStrings(value, rawStrings, new Set()); for (const text of rawStrings) { let normalized = text.replaceAll(String.fromCharCode(92), "/"); while (normalized.includes("//")) normalized = normalized.replaceAll("//", "/"); if (/[A-Za-z]:\/Users\/(?!<[^>]+>)[^/\s"']+\//iu.test(normalized)) throw new Error("Novice evidence contains a sensitive user path."); } }
function collectStrings(value, output, seen) { if (typeof value === "string") { output.push(value); return; } if (!value || typeof value !== "object") return; if (seen.has(value)) throw new Error("Novice evidence is cyclic."); seen.add(value); if (Array.isArray(value)) for (const item of value) collectStrings(item, output, seen); else for (const item of Object.values(value)) collectStrings(item, output, seen); seen.delete(value); }
function uniqueStrings(value, label) { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length < 1 || item.length > 1000)) throw new Error("Novice " + label + " are invalid."); if (new Set(value).size !== value.length) throw new Error("Duplicate novice " + label + "."); return [...value]; }
function strings(value,label) { if(!Array.isArray(value)||value.some((item)=>typeof item!=="string"||item.length<1||item.length>1000)) throw new Error("Novice "+label+" are invalid."); return [...value]; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Novice " + label + " must be an object."); return value; }
function exactKeys(value, expected, label) { const unknown = Object.keys(value).filter((key) => !expected.includes(key)); const missing = expected.filter((key) => !Object.hasOwn(value, key)); if (unknown.length) throw new Error("Unknown novice " + label + " field."); if (missing.length) throw new Error("Missing novice " + label + " field: " + missing.join(", ")); }
function timestamp(value, label) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("Novice " + label + " is invalid."); }
function version(value, label) { if (typeof value !== "string" || !/^(?:v)?[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(value)) throw new Error("Novice " + label + " is invalid."); }
function commit(value, label) { if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) throw new Error("Novice " + label + " is invalid."); }

function buildExpectedScenarioExecutions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((scenario) => ({ scenarioId: scenario.id, verdict: "pass", preconditions: scenario.preconditions, actions: scenario.actions, promptCodes: scenario.expectedPromptCodes, invariants: scenario.invariants, faults: scenario.faults, recovery: scenario.recovery, probes: scenario.requiredProbes })).sort((a,b)=>a.scenarioId.localeCompare(b.scenarioId));
}
function validateScenarioExecutionEvidence(raw, expected) {
  if (!Array.isArray(raw) || !expected || raw.length !== expected.length) throw new Error("Novice scenario execution evidence is incomplete.");
  const sorted = [...raw].sort((a,b)=>String(a?.scenarioId).localeCompare(String(b?.scenarioId)));
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) throw new Error("Novice scenario execution actions, prompts, invariants, faults, recovery, or probes differ from the accepted inventory.");
}
export async function resolveNoviceEvidenceInput(rootInput, args) {
  const root = path.resolve(rootInput);
  if (args[0] === "--external") {
    if (args.length !== 2 || !path.isAbsolute(args[1])) throw new Error("External novice evidence requires one absolute path.");
    const file = path.resolve(args[1]);
    const info = await lstat(file).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || !same(await realpath(file), file)) throw new Error("External novice evidence must be a canonical regular file.");
    return file;
  }
  const arg = args[0];
  if (args.length !== 1 || !arg || path.isAbsolute(arg) || arg.includes("..")) throw new Error("Evidence path must be repository-relative or explicitly external.");
  const file = path.resolve(root, arg);
  const relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Novice evidence path escapes the package.");
  return file;
}
async function main() { const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))); const file = await resolveNoviceEvidenceInput(root, process.argv.slice(2)); const value = JSON.parse(await readFile(file, "utf8")); const scenarioDefinitions = JSON.parse(await readFile(path.join(root, "quality", "scenarios", "novice-daily-use.json"), "utf8")); const scenarios = scenarioDefinitions.map((item) => item.id); const result = validateNoviceEvidence(value, { scenarioIds: scenarios, scenarioDefinitions }); process.stdout.write("Novice evidence valid: verdict=" + result.verdict + "; repetitions=" + result.repetitions + "; scenarios=" + result.scenarios + "\n"); }
function same(left, right) { return process.platform === "win32" ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right; }
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { process.stderr.write("novice-evidence: " + (error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; });
