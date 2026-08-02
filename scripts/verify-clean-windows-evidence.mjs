import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const stageIds = ["qualify", "install", "doctor", "service", "weixin_login", "codex_desktop", "seven_primitives", "weixin_e2e", "upgrade", "rollback", "uninstall"];
const requiredApprovals = ["weixin_login", "real_codex_home", "hook_trust", "desktop_restart", "computer_use", "real_weixin_send"];
const qualifyingKinds = ["second_computer", "resettable_vm"];
const evidenceTypes = ["sha256", "command_hash", "result_hash", "screenshot_hash"];
const stageEvidenceTypes = {
  qualify: ["sha256", "result_hash"], install: ["sha256", "command_hash"], doctor: ["command_hash", "result_hash"],
  service: ["command_hash", "result_hash"], weixin_login: ["result_hash", "screenshot_hash"], codex_desktop: ["result_hash", "screenshot_hash"],
  seven_primitives: ["sha256", "result_hash"], weixin_e2e: ["sha256", "result_hash"], upgrade: ["sha256", "command_hash"],
  rollback: ["sha256", "command_hash"], uninstall: ["sha256", "command_hash"],
};
const approvalStage = {
  weixin_login: "weixin_login", real_codex_home: "codex_desktop", hook_trust: "codex_desktop",
  desktop_restart: "codex_desktop", computer_use: "codex_desktop", real_weixin_send: "weixin_e2e",
};
const secretPattern = /(?:bearer\s+[^ ]+|sk-[A-Za-z0-9_-]{8,}|(?:token|secret|password|credential)\s*[:=]\s*[^ <[]+)/iu;
const userPathPattern = /[A-Za-z]:[\\/]Users[\\/](?!<[^>]+>)[^\\/\s"']+/iu;

export function validateCleanWindowsEvidence(value) {
  object(value, "clean Windows evidence");
  exact(value, ["approvals", "archive", "commands", "environment", "schemaVersion", "stages", "versions"]);
  if (value.schemaVersion !== 2) throw new Error("Clean Windows evidence schema is unsupported.");
  const environment = object(value.environment, "environment");
  exact(environment, ["arch", "freshProfile", "kind", "os", "priorChat2CodexAbsent", "repositoryAbsent"]);
  const qualifyingEnvironment = qualifyingKinds.includes(environment.kind) && environment.freshProfile === true &&
    environment.repositoryAbsent === true && environment.priorChat2CodexAbsent === true && environment.os === "Windows 11" &&
    ["x64", "arm64"].includes(environment.arch);
  const archive = object(value.archive, "archive");
  exact(archive, ["sha256", "size", "version"]);
  if (typeof archive.version !== "string" || archive.version.length < 1 || archive.version.length > 80 ||
      !Number.isSafeInteger(archive.size) || archive.size < 1 || typeof archive.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(archive.sha256)) {
    throw new Error("Clean Windows archive hash or version is invalid.");
  }
  const versions = object(value.versions, "versions");
  exact(versions, ["codexCli", "codexDesktop", "node", "npm"]);
  for (const version of Object.values(versions)) if (typeof version !== "string" || version.length < 1 || version.length > 80) throw new Error("Clean Windows version is invalid.");
  if (!Array.isArray(value.commands) || value.commands.length > 256) throw new Error("Clean Windows commands are invalid.");
  for (const rawCommand of value.commands) {
    const command = object(rawCommand, "command");
    exact(command, ["command", "exitCode", "observedAt"]);
    if (typeof command.command !== "string" || command.command.length < 1 || command.command.length > 1000 || unsafe(command.command)) throw new Error("Clean Windows command must redact secrets and user paths.");
    if (!Number.isSafeInteger(command.exitCode)) throw new Error("Clean Windows command exit is invalid.");
    timestamp(command.observedAt);
  }
  if (!Array.isArray(value.approvals) || value.approvals.length > 32) throw new Error("Clean Windows approvals are invalid.");
  const approvals = new Set();
  const approvalTimes = new Map();
  for (const rawApproval of value.approvals) {
    const approval = object(rawApproval, "approval");
    exact(approval, ["action", "approvedAt", "approvedBy"]);
    if (!requiredApprovals.includes(approval.action) || approval.approvedBy !== "Haoda" || approvals.has(approval.action)) throw new Error("Clean Windows approval is invalid or duplicated.");
    timestamp(approval.approvedAt);
    approvals.add(approval.action);
    approvalTimes.set(approval.action, Date.parse(approval.approvedAt));
  }
  if (!Array.isArray(value.stages) || value.stages.length !== stageIds.length) throw new Error("Clean Windows stages are incomplete.");
  let directPasses = 0;
  for (const rawStage of value.stages) {
    const stage = object(rawStage, "stage");
    exact(stage, ["completedAt", "evidence", "id", "startedAt", "verdict"]);
    if (!stageIds.includes(stage.id) || !["unproven", "pass", "contradicted"].includes(stage.verdict) || !Array.isArray(stage.evidence) || stage.evidence.length > 64) throw new Error("Clean Windows stage is invalid.");
    const evidenceKeys = new Set();
    const observedTypes = new Set();
    for (const rawEvidence of stage.evidence) {
      const evidence = object(rawEvidence, "stage evidence");
      exact(evidence, ["type", "value"]);
      const evidenceKey = evidence.type + "|" + evidence.value;
      if (evidenceKeys.has(evidenceKey)) throw new Error("Clean Windows stage evidence contains duplicates.");
      evidenceKeys.add(evidenceKey);
      observedTypes.add(evidence.type);
      if (!evidenceTypes.includes(evidence.type) || typeof evidence.value !== "string" || !/^[a-f0-9]{64}$/u.test(evidence.value)) throw new Error("Clean Windows stage evidence requires a typed SHA-256 value.");
    }
    if (stage.verdict === "pass") {
      directPasses += 1;
      if (stage.startedAt === null || stage.completedAt === null || stageEvidenceTypes[stage.id].some((type) => !observedTypes.has(type))) throw new Error("Passing clean Windows stage requires timestamps and its code-owned evidence types.");
    }
    if (stage.startedAt !== null) timestamp(stage.startedAt);
    if (stage.completedAt !== null) timestamp(stage.completedAt);
    if (stage.startedAt !== null && stage.completedAt !== null && Date.parse(stage.completedAt) < Date.parse(stage.startedAt)) throw new Error("Clean Windows stage timestamps are reversed.");
  }
  if (new Set(value.stages.map((stage) => stage.id)).size !== stageIds.length) throw new Error("Clean Windows stage identities are incomplete.");
  if (directPasses > 0) {
    if (!qualifyingEnvironment || /^0+$/u.test(archive.sha256)) throw new Error("Passing evidence requires a qualifying clean Windows environment and immutable archive.");
    if (value.commands.length === 0 || value.commands.some((command) => command.exitCode !== 0)) throw new Error("Passing clean Windows evidence requires successful commands.");
    for (const approval of requiredApprovals) {
      if (!approvals.has(approval)) throw new Error("Missing clean Windows approval: " + approval);
      const stage = value.stages.find((item) => item.id === approvalStage[approval]);
      if (!stage || approvalTimes.get(approval) > Date.parse(stage.startedAt)) throw new Error("Clean Windows approval occurred after its action: " + approval);
    }
    if (value.stages.some((stage) => stage.verdict !== "pass")) throw new Error("Clean Windows passing claim requires every stage.");
  }
  assertSafeStrings(value);
  return { qualifyingEnvironment, directPasses };
}

function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " must be an object."); return value; }
function exact(value, keys) { const actual = Object.keys(value); if (actual.some((key) => !keys.includes(key)) || keys.some((key) => !actual.includes(key))) throw new Error("Clean Windows evidence fields are invalid."); }
function timestamp(value) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("Clean Windows timestamp is invalid."); }
function unsafe(value) { return secretPattern.test(value) || userPathPattern.test(value); }
function assertSafeStrings(value) { const strings = []; collectStrings(value, strings); if (strings.some(unsafe)) throw new Error("Clean Windows evidence contains an unredacted secret or user path."); }
function collectStrings(value, output) { if (typeof value === "string") { output.push(value); return; } if (!value || typeof value !== "object") return; if (Array.isArray(value)) for (const item of value) collectStrings(item, output); else for (const item of Object.values(value)) collectStrings(item, output); }

async function main() {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const relative = process.argv[2];
  if (!relative || path.isAbsolute(relative)) throw new Error("Clean Windows manifest path must be repository-relative.");
  const file = path.resolve(root, relative);
  const rel = path.relative(root, file);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error("Clean Windows manifest escapes the repository.");
  const result = validateCleanWindowsEvidence(JSON.parse(await readFile(file, "utf8")));
  process.stdout.write("Clean Windows evidence valid: qualifying=" + result.qualifyingEnvironment + "; directPasses=" + result.directPasses + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { process.stderr.write("clean-windows-evidence: " + (error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; });
}
