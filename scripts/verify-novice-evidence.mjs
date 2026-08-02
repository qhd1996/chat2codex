import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const authorityCommit = "01e827bbdc6584136627d9f1f137e8051f0a8c97";
const manifestKeys = ["archive", "authorityCommit", "environment", "evidenceLevel", "failureHistory", "generatedAt", "repetitions", "repositoryCommit", "scenarioIds", "schemaVersion", "verdict", "versions"];
const environmentKeys = ["arch", "freshProfile", "kind", "os", "priorPackageAbsent", "productionUntouched", "realUserCodexHomeUntouched", "repositoryAbsent"];
const archiveKeys = ["sha256", "size", "version"];
const versionKeys = ["bun", "codexCli", "node", "npm", "package", "windows"];
const repetitionKeys = ["commands", "completedAt", "counts", "index", "scenarioIds", "seed", "startedAt", "stateHashes", "verdict"];
const countKeys = ["fail", "pass", "residualProcesses", "skip", "timeout"];
const historyKeys = ["code", "fixedByCommit", "repetition"];

export function validateNoviceEvidence(value, options) {
  const manifest = object(value, "manifest"); exactKeys(manifest, manifestKeys, "manifest");
  if (manifest.schemaVersion !== 1) throw new Error("Novice evidence schema version is unsupported.");
  if (manifest.authorityCommit !== authorityCommit) throw new Error("Novice evidence authority commit is invalid.");
  commit(manifest.repositoryCommit, "repository commit"); timestamp(manifest.generatedAt, "generatedAt");
  if (manifest.evidenceLevel !== "repository" && manifest.evidenceLevel !== "isolated_package") throw new Error("Novice evidence level is invalid.");
  if (manifest.verdict !== "unproven" && manifest.verdict !== "repository_pass" && manifest.verdict !== "pass") throw new Error("Novice evidence verdict is invalid.");
  const expectedScenarioIds = uniqueStrings(options?.scenarioIds, "expected scenario IDs").sort();
  if (manifest.verdict === "unproven") {
    if (!Array.isArray(manifest.repetitions) || manifest.repetitions.length !== 0) throw new Error("Unproven novice template cannot contain repetitions.");
    if (!Array.isArray(manifest.scenarioIds) || manifest.scenarioIds.length !== 0) throw new Error("Unproven novice template cannot claim scenario coverage.");
    validateEnvironment(manifest.environment, false); validateArchive(manifest.archive, false); validateVersions(manifest.versions);
    if (!Array.isArray(manifest.failureHistory)) throw new Error("Novice failure history is invalid.");
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
  for (const [offset, raw] of manifest.repetitions.entries()) validateRepetition(raw, offset + 1, expectedScenarioIds);
  validateFailureHistory(manifest.failureHistory);
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
function validateRepetition(raw, expectedIndex, expectedScenarioIds) { const value = object(raw, "repetition"); exactKeys(value, repetitionKeys, "repetition"); if (value.index !== expectedIndex) throw new Error("Novice repetition index is not consecutive."); if (!Number.isSafeInteger(value.seed)) throw new Error("Missing novice repetition seed."); timestamp(value.startedAt, "startedAt"); timestamp(value.completedAt, "completedAt"); if (value.verdict !== "pass") throw new Error("Novice repetition did not pass."); const counts = object(value.counts, "counts"); exactKeys(counts, countKeys, "counts"); for (const [key, count] of Object.entries(counts)) if (!Number.isSafeInteger(count) || count < 0) throw new Error("Novice repetition count is invalid: " + key); if (counts.fail !== 0 || counts.skip !== 0 || counts.timeout !== 0 || counts.residualProcesses !== 0) throw new Error("Novice repetition requires zero fail, skip, timeout, and residual counts."); if (counts.pass < expectedScenarioIds.length) throw new Error("Novice repetition pass count is incomplete."); const scenarios = uniqueStrings(value.scenarioIds, "repetition scenario IDs").sort(); if (JSON.stringify(scenarios) !== JSON.stringify(expectedScenarioIds)) throw new Error("Novice repetition scenario coverage is incomplete."); const hashes = uniqueStrings(value.stateHashes, "state hashes"); if (hashes.length === 0 || hashes.some((hash) => !/^[a-f0-9]{64}$/u.test(hash))) throw new Error("Novice repetition state hash is invalid."); const commands = uniqueStrings(value.commands, "commands"); if (commands.length === 0 || commands.some((command) => command.length > 1000)) throw new Error("Novice repetition command evidence is invalid."); }
function validateFailureHistory(raw) { if (!Array.isArray(raw) || raw.length > 256) throw new Error("Novice failure history is invalid."); for (const itemRaw of raw) { const item = object(itemRaw, "failure history"); exactKeys(item, historyKeys, "failure history"); if (!Number.isSafeInteger(item.repetition) || item.repetition < 1 || item.repetition > 30 || typeof item.code !== "string" || item.code.length < 1 || item.code.length > 160 || item.fixedByCommit !== null && (typeof item.fixedByCommit !== "string" || !/^[a-f0-9]{40}$/u.test(item.fixedByCommit))) throw new Error("Novice failure history record is invalid."); } }
function assertNoviceOutputSafe(value) { let source; try { source = JSON.stringify(value); } catch { throw new Error("Novice evidence is not safely serializable."); } if (/(?:Bearer[ \t]+[A-Za-z0-9._~+/-]{20,}|novice-secret-canary-|prompt-canary[ \t]*:|identity-canary(?:@|:)|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/iu.test(source)) throw new Error("Novice evidence contains sensitive unredacted output."); const rawStrings = []; collectStrings(value, rawStrings, new Set()); for (const text of rawStrings) { let normalized = text.replaceAll(String.fromCharCode(92), "/"); while (normalized.includes("//")) normalized = normalized.replaceAll("//", "/"); if (/[A-Za-z]:\/Users\/(?!<[^>]+>)[^/\s"']+\//iu.test(normalized)) throw new Error("Novice evidence contains a sensitive user path."); } }
function collectStrings(value, output, seen) { if (typeof value === "string") { output.push(value); return; } if (!value || typeof value !== "object") return; if (seen.has(value)) throw new Error("Novice evidence is cyclic."); seen.add(value); if (Array.isArray(value)) for (const item of value) collectStrings(item, output, seen); else for (const item of Object.values(value)) collectStrings(item, output, seen); seen.delete(value); }
function uniqueStrings(value, label) { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length < 1 || item.length > 1000)) throw new Error("Novice " + label + " are invalid."); if (new Set(value).size !== value.length) throw new Error("Duplicate novice " + label + "."); return [...value]; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Novice " + label + " must be an object."); return value; }
function exactKeys(value, expected, label) { const unknown = Object.keys(value).filter((key) => !expected.includes(key)); const missing = expected.filter((key) => !Object.hasOwn(value, key)); if (unknown.length) throw new Error("Unknown novice " + label + " field."); if (missing.length) throw new Error("Missing novice " + label + " field: " + missing.join(", ")); }
function timestamp(value, label) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("Novice " + label + " is invalid."); }
function version(value, label) { if (typeof value !== "string" || !/^(?:v)?[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(value)) throw new Error("Novice " + label + " is invalid."); }
function commit(value, label) { if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) throw new Error("Novice " + label + " is invalid."); }

async function main() { const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))); const arg = process.argv[2]; if (!arg || path.isAbsolute(arg) || arg.includes("..")) throw new Error("Evidence path must be repository-relative."); const value = JSON.parse(await readFile(path.join(root, arg), "utf8")); const scenarios = JSON.parse(await readFile(path.join(root, "quality", "scenarios", "novice-daily-use.json"), "utf8")).map((item) => item.id); const result = validateNoviceEvidence(value, { scenarioIds: scenarios }); process.stdout.write("Novice evidence valid: verdict=" + result.verdict + "; repetitions=" + result.repetitions + "; scenarios=" + result.scenarios + "\n"); }
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { process.stderr.write("novice-evidence: " + (error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; });
