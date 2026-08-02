import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prohibitedTaskId = "019fc002-590e-7023-b7e5-2a802168f00a";
const approvedAuthorityRepo = "F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/";
const approvedAuthorityCommit = "07603ee8ddd38546aca003ff7be8370aa9a51203";
const artifactFiles = {
  proposal: "proposal.md",
  specs: path.join("specs", "quality-gates", "spec.md"),
  design: "design.md",
  tasks: "tasks.md",
};
const lockKeys = ["acceptedChangeIds", "authorityCommit", "authorityRepo", "authoritative", "files", "note", "requirementIds", "schemaVersion"];
const metadataKeys = ["acceptedBy", "artifact", "authorityCommit", "authorityRepo", "changeName", "productionAuthorized", "realExternalActionsAuthorized", "requirementIds"];

export async function validateOpenSpecAuthority({ changeRoot, lock }) {
  validateLock(lock);
  const expectedName = path.basename(path.resolve(changeRoot));
  const observedRequirements = new Set();
  let artifactCount = 0;
  for (const [artifactKind, relativePath] of Object.entries(artifactFiles)) {
    const source = await readFile(path.join(changeRoot, relativePath), "utf8").catch((error) => {
      throw new Error(`OpenSpec artifact is missing: ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    });
    const metadata = parseMetadata(source, relativePath);
    assertExactKeys(metadata, metadataKeys, "metadata");
    if (metadata.changeName !== expectedName) throw new Error(`OpenSpec change name mismatch in ${relativePath}.`);
    if (metadata.artifact !== artifactKind) throw new Error(`OpenSpec artifact kind mismatch in ${relativePath}.`);
    if (metadata.authorityCommit !== lock.authorityCommit) throw new Error(`OpenSpec authority commit mismatch in ${relativePath}.`);
    if (metadata.authorityRepo !== lock.authorityRepo) throw new Error(`OpenSpec authority repo mismatch in ${relativePath}.`);
    if (metadata.acceptedBy !== "Haoda") throw new Error(`OpenSpec acceptedBy must be Haoda in ${relativePath}.`);
    if (metadata.productionAuthorized !== false) throw new Error(`Production is not authorized by OpenSpec metadata in ${relativePath}.`);
    if (metadata.realExternalActionsAuthorized !== false) throw new Error(`Real external actions are not authorized by OpenSpec metadata in ${relativePath}.`);
    if (!Array.isArray(metadata.requirementIds) || metadata.requirementIds.length === 0 || metadata.requirementIds.length > 24) {
      throw new Error(`OpenSpec requirementIds are invalid in ${relativePath}.`);
    }
    for (const requirementId of metadata.requirementIds) {
      if (typeof requirementId !== "string" || !lock.requirementIds.includes(requirementId)) {
        throw new Error(`Unknown requirement ID in ${relativePath}: ${String(requirementId)}`);
      }
      observedRequirements.add(requirementId);
    }
    const body = source.replace(/^<!-- chat2codex-authority .*?-->\s*/su, "");
    if (/OpenSpec\s+is\s+(?:the\s+)?authoritative/iu.test(body)) throw new Error(`OpenSpec authority inflation in ${relativePath}.`);
    if (source.includes(prohibitedTaskId)) throw new Error(`Prohibited task reference in ${relativePath}.`);
    artifactCount += 1;
  }
  return { changeName: expectedName, artifactCount, requirementIds: [...observedRequirements].sort() };
}

function validateLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) throw new Error("Authority lock must be an object.");
  assertExactKeys(lock, lockKeys, "lock");
  if (lock.schemaVersion !== 1) throw new Error("Authority lock schema version is unsupported.");
  if (lock.authoritative !== false) throw new Error("Authority lock must remain non-authoritative.");
  if (lock.authorityRepo !== approvedAuthorityRepo) throw new Error("Approved authority repo does not match the lock.");
  if (lock.authorityCommit !== approvedAuthorityCommit) throw new Error("Approved authority commit does not match the lock.");
  if (typeof lock.authorityRepo !== "string" || !lock.authorityRepo.endsWith("/docs/requirements/")) throw new Error("Authority lock repo is invalid.");
  if (typeof lock.authorityCommit !== "string" || !/^[0-9a-f]{40}$/u.test(lock.authorityCommit)) throw new Error("Authority lock commit is invalid.");
  if (!Array.isArray(lock.acceptedChangeIds) || !lock.acceptedChangeIds.every((value) => /^CR-[0-9]{4}$/u.test(value))) throw new Error("Authority lock accepted changes are invalid.");
  if (!Array.isArray(lock.requirementIds) || !lock.requirementIds.every((value) => /^[A-Z]+(?:-[A-Z]+)*-[0-9]{3}$/u.test(value))) throw new Error("Authority lock requirement IDs are invalid.");
  if (new Set(lock.acceptedChangeIds).size !== lock.acceptedChangeIds.length) throw new Error("Duplicate accepted change ID in authority lock.");
  if (new Set(lock.requirementIds).size !== lock.requirementIds.length) throw new Error("Duplicate requirement ID in authority lock.");
  if (!Array.isArray(lock.files)) throw new Error("Authority lock files are invalid.");
  const lockedPaths = new Set();
  for (const file of lock.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("Authority lock file entry is invalid.");
    assertExactKeys(file, ["path", "sha256"], "lock file");
    if (typeof file.path !== "string" || !/^docs\/requirements\/[A-Za-z0-9._/-]+$/u.test(file.path) || file.path.includes("..")) throw new Error("Authority lock file path is invalid.");
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(file.sha256)) throw new Error("Authority lock file SHA-256 is invalid.");
    if (lockedPaths.has(file.path)) throw new Error("Duplicate authority lock file path.");
    lockedPaths.add(file.path);
  }
  if (typeof lock.note !== "string" || lock.note.length < 1 || lock.note.length > 500) throw new Error("Authority lock note is invalid.");
}

function parseMetadata(source, relativePath) {
  const match = source.match(/^<!-- chat2codex-authority (\{[^\r\n]+\}) -->/u);
  if (!match) throw new Error(`OpenSpec authority metadata is missing from ${relativePath}.`);
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error(`OpenSpec authority metadata is malformed in ${relativePath}.`);
  }
}

function assertExactKeys(value, allowed, label) {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  const unknown = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actual.includes(key));
  if (unknown.length) throw new Error(`Unknown ${label} field: ${unknown.join(", ")}`);
  if (missing.length) throw new Error(`Missing ${label} field: ${missing.join(", ")}`);
}

async function main() {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const lock = JSON.parse(await readFile(path.join(root, "quality", "authority", "requirements-ledger.json"), "utf8"));
  const result = await validateOpenSpecAuthority({ changeRoot: path.join(root, "openspec", "changes", "minimal-quality-acceleration"), lock });
  process.stdout.write(`OpenSpec authority valid: ${result.changeName}; artifacts=${result.artifactCount}; requirements=${result.requirementIds.length}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`openspec-authority: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
