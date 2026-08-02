import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const levels = ["static", "automated", "installed_behavior", "real_e2e"];
const approvedAuthorityCommit = "21a5800c4d725375af256a1e1c827bab75c3f034";
const verdicts = ["unproven", "pass", "contradicted"];
const outcomes = ["pass", "fail", "incomplete", "contradicted"];
const manifestKeys = ["authorityCommit", "evidence", "generatedAt", "manifestId", "repositoryCommit", "schemaVersion", "targets"];
const targetKeys = ["evidenceIds", "id", "requiredLevel", "verdict"];
const evidenceKeys = ["artifact", "counts", "dirty", "id", "level", "note", "observedAt", "outcome", "platform", "procedure", "repositoryCommit", "targetId", "versions"];
const forbiddenNote = /(?:bearer\s+[A-Za-z0-9._~+/-]{8,}|sk-[A-Za-z0-9_-]{8,}|(?:password|credential|token|raw\s*prompt|sender)\s*[:=]|[A-Za-z]:[\\/](?:Users|private|secret)[\\/]|\/home\/[^/]+\/|\\\\[^\\]+\\)/iu;

export async function validateEvidenceManifest(value, { repositoryRoot, commitExists }) {
  const manifest = object(value, "manifest");
  exactKeys(manifest, manifestKeys, "manifest");
  if (manifest.schemaVersion !== 1) throw new Error("Evidence schema version is unsupported.");
  boundedId(manifest.manifestId, "manifest ID", /^[a-z0-9][a-z0-9._-]{0,127}$/u);
  commit(manifest.authorityCommit, "authority commit");
  if (manifest.authorityCommit !== approvedAuthorityCommit) throw new Error("Approved authority commit does not match the evidence manifest.");
  commit(manifest.repositoryCommit, "repository commit");
  if (commitExists) {
    if (!await commitExists(manifest.repositoryCommit)) throw new Error("Repository commit is not available in the repository.");
  }
  timestamp(manifest.generatedAt, "generatedAt");
  if (!Array.isArray(manifest.targets) || manifest.targets.length > 128) throw new Error("Evidence targets are invalid.");
  if (!Array.isArray(manifest.evidence) || manifest.evidence.length > 256) throw new Error("Evidence records are invalid.");

  const targetById = new Map();
  for (const rawTarget of manifest.targets) {
    const target = object(rawTarget, "target");
    exactKeys(target, targetKeys, "target");
    boundedId(target.id, "target ID", /^[A-Z][A-Z0-9._-]{2,127}$/u);
    if (targetById.has(target.id)) throw new Error(`Duplicate target ID: ${target.id}`);
    if (!levels.includes(target.requiredLevel)) throw new Error(`Unknown required evidence level for ${target.id}.`);
    if (!verdicts.includes(target.verdict)) throw new Error(`Unknown target verdict for ${target.id}.`);
    if (!Array.isArray(target.evidenceIds) || target.evidenceIds.length > 64 || !target.evidenceIds.every((id) => typeof id === "string" && id.length >= 1 && id.length <= 128)) throw new Error(`Invalid evidence references for ${target.id}.`);
    if (new Set(target.evidenceIds).size !== target.evidenceIds.length) throw new Error(`Duplicate evidence reference for ${target.id}.`);
    targetById.set(target.id, target);
  }

  const evidenceById = new Map();
  const declaredEvidenceIds = new Set();
  for (const rawEvidence of manifest.evidence) {
    const evidence = object(rawEvidence, "evidence");
    boundedId(evidence.id, "evidence ID", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
    if (declaredEvidenceIds.has(evidence.id)) throw new Error(`Duplicate evidence ID: ${evidence.id}`);
    declaredEvidenceIds.add(evidence.id);
  }
  for (const target of targetById.values()) {
    for (const evidenceId of target.evidenceIds) {
      if (!declaredEvidenceIds.has(evidenceId)) throw new Error(`Missing evidence referenced by ${target.id}: ${evidenceId}`);
    }
  }
  for (const rawEvidence of manifest.evidence) {
    const evidence = object(rawEvidence, "evidence");
    exactKeys(evidence, evidenceKeys, "evidence");
    boundedId(evidence.id, "evidence ID", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
    if (evidenceById.has(evidence.id)) throw new Error(`Duplicate evidence ID: ${evidence.id}`);
    if (!targetById.has(evidence.targetId)) throw new Error(`Evidence references unknown target: ${String(evidence.targetId)}`);
    if (!levels.includes(evidence.level)) throw new Error(`Unknown evidence level for ${evidence.id}.`);
    if (!outcomes.includes(evidence.outcome)) throw new Error(`Unknown evidence outcome for ${evidence.id}.`);
    timestamp(evidence.observedAt, "observedAt");
    commit(evidence.repositoryCommit, "evidence repository commit");
    if (evidence.repositoryCommit !== manifest.repositoryCommit) throw new Error(`Evidence repository commit mismatch for ${evidence.id}.`);
    if (commitExists && !await commitExists(evidence.repositoryCommit)) throw new Error(`Evidence repository commit is not available for ${evidence.id}.`);
    if (typeof evidence.dirty !== "boolean") throw new Error(`Evidence dirty flag is invalid for ${evidence.id}.`);
    validatePlatform(evidence.platform);
    validateVersions(evidence.versions);
    validateProcedure(evidence.procedure);
    validateCounts(evidence.counts);
    if (typeof evidence.note !== "string" || evidence.note.length < 1 || evidence.note.length > 500) throw new Error(`Evidence note is invalid for ${evidence.id}.`);
    if (forbiddenNote.test(evidence.note)) throw new Error(`Forbidden value in evidence note for ${evidence.id}.`);
    if (evidence.outcome === "pass") {
      if (evidence.dirty) throw new Error(`Dirty evidence cannot pass: ${evidence.id}.`);
      const counts = evidence.counts;
      if (counts.fail !== 0 || counts.timeout !== 0 || counts.residualRoot !== 0 || counts.residualChildren !== 0) throw new Error(`Passing evidence requires zero failures, timeouts, and residuals: ${evidence.id}.`);
    }
    await validateArtifact(evidence.artifact, repositoryRoot, evidence.id);
    evidenceById.set(evidence.id, evidence);
  }

  let passedTargets = 0;
  const referencedEvidence = new Set();
  for (const target of targetById.values()) {
    for (const evidenceId of target.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) throw new Error(`Missing evidence referenced by ${target.id}: ${evidenceId}`);
      if (evidence.targetId !== target.id) throw new Error(`Evidence target mismatch for ${evidenceId}.`);
      referencedEvidence.add(evidenceId);
    }
    const records = target.evidenceIds.map((id) => evidenceById.get(id));
    if (target.verdict === "pass") {
      if (records.length === 0 || records.some((record) => record.outcome !== "pass")) throw new Error(`Passing target lacks passing evidence: ${target.id}.`);
      const requiredRank = levels.indexOf(target.requiredLevel);
      if (records.every((record) => levels.indexOf(record.level) < requiredRank)) throw new Error(`Evidence level does not satisfy ${target.requiredLevel} for ${target.id}.`);
      passedTargets += 1;
    }
    if (target.verdict === "unproven") {
      const requiredRank = levels.indexOf(target.requiredLevel);
      if (records.some((record) => record.outcome === "pass" && levels.indexOf(record.level) >= requiredRank)) throw new Error(`Unproven target has sufficient passing evidence: ${target.id}.`);
    }
    if (target.verdict === "contradicted" && !records.some((record) => record.outcome === "contradicted")) throw new Error(`Contradicted target lacks contradicted evidence: ${target.id}.`);
  }
  for (const evidenceId of evidenceById.keys()) if (!referencedEvidence.has(evidenceId)) throw new Error(`Orphan evidence record: ${evidenceId}.`);

  return { manifestId: manifest.manifestId, targets: manifest.targets.length, evidence: manifest.evidence.length, passedTargets };
}

async function validateArtifact(rawArtifact, repositoryRoot, evidenceId) {
  const artifact = object(rawArtifact, "artifact");
  exactKeys(artifact, ["path", "sha256"], "artifact");
  if (typeof artifact.path !== "string" || artifact.path.length < 1 || artifact.path.length > 500 || path.isAbsolute(artifact.path)) throw new Error(`Artifact path must be repository-relative for ${evidenceId}.`);
  if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(artifact.sha256)) throw new Error(`Artifact SHA-256 is invalid for ${evidenceId}.`);
  const root = path.resolve(repositoryRoot);
  const candidate = path.resolve(root, artifact.path);
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Artifact is outside the repository for ${evidenceId}.`);
  const info = await lstat(candidate).catch(() => undefined);
  if (!info) throw new Error(`Missing regular artifact for ${evidenceId}.`);
  if (info.isSymbolicLink()) throw new Error(`Artifact symlink is forbidden for ${evidenceId}.`);
  if (!info.isFile()) throw new Error(`Missing regular artifact for ${evidenceId}.`);
  const canonical = await realpath(candidate);
  if (!samePath(canonical, candidate)) throw new Error(`Artifact path is not canonical for ${evidenceId}.`);
  const digest = createHash("sha256").update(await readFile(candidate)).digest("hex");
  if (digest !== artifact.sha256) throw new Error(`Artifact hash mismatch for ${evidenceId}.`);
}

function validatePlatform(raw) {
  const value = object(raw, "platform"); exactKeys(value, ["arch", "os"], "platform");
  boundedId(value.os, "platform OS", /^[a-z0-9._-]{2,32}$/u); boundedId(value.arch, "platform arch", /^[a-z0-9._-]{2,32}$/u);
}
function validateVersions(raw) {
  const value = object(raw, "versions"); exactKeys(value, ["bun", "node", "package"], "versions");
  for (const [key, version] of Object.entries(value)) if (typeof version !== "string" || !/^(?:v)?[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(version)) throw new Error(`${key} version is invalid.`);
}
function validateProcedure(raw) {
  const value = object(raw, "procedure"); exactKeys(value, ["kind", "value"], "procedure");
  if (value.kind !== "command" && value.kind !== "manual") throw new Error("Evidence procedure kind is invalid.");
  if (typeof value.value !== "string" || value.value.length < 1 || value.value.length > 1000) throw new Error("Evidence procedure is invalid.");
}
function validateCounts(raw) {
  const value = object(raw, "counts"); exactKeys(value, ["fail", "pass", "residualChildren", "residualRoot", "skip", "timeout"], "counts");
  for (const [name, count] of Object.entries(value)) if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Evidence count is invalid: ${name}.`);
}
function timestamp(value, name) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${name} must be a canonical UTC timestamp.`);
}
function commit(value, name) { if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${name} is invalid.`); }
function boundedId(value, name, pattern) { if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${name} is invalid.`); }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value; }
function exactKeys(value, allowed, label) {
  const actual = Object.keys(value); const unknown = actual.filter((key) => !allowed.includes(key)); const missing = allowed.filter((key) => !actual.includes(key));
  if (unknown.length) throw new Error(`Unknown ${label} field: ${unknown.join(", ")}`);
  if (missing.length) throw new Error(`Missing ${label} field: ${missing.join(", ")}`);
}
function samePath(left, right) { return process.platform === "win32" ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right; }

async function main() {
  const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const manifestArg = process.argv[2];
  if (!manifestArg || path.isAbsolute(manifestArg)) throw new Error("Manifest path must be repository-relative.");
  const manifestPath = path.resolve(repositoryRoot, manifestArg);
  const relative = path.relative(repositoryRoot, manifestPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Manifest path is outside the repository.");
  const info = await lstat(manifestPath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Manifest must be a regular non-symlink file.");
  const value = JSON.parse(await readFile(manifestPath, "utf8"));
  const commitExists = async (commitId) => {
    const result = spawnSync("git", ["cat-file", "-e", `${commitId}^{commit}`], { cwd: repositoryRoot, shell: false, windowsHide: true, stdio: "ignore" });
    if (result.error) throw result.error;
    return result.status === 0;
  };
  const result = await validateEvidenceManifest(value, { repositoryRoot, commitExists });
  process.stdout.write(`Evidence manifest valid: ${result.manifestId}; targets=${result.targets}; evidence=${result.evidence}; passed=${result.passedTargets}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { process.stderr.write(`quality-evidence: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
