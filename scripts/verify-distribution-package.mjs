import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const manifestKeys = ["codexCli", "desktop", "hooks", "node", "packageRoots", "packageVersion", "provenance", "requiredDocs", "schemaVersion", "stateSchemas", "windows"];
const forbiddenPath = /(?:C:[\/]Users[\/]dada|F:[\/](?:workspace|Chat2Codex|codex)|\bdada\b)/iu;
const secret = /(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|Bearer[ \t]+[A-Za-z0-9._~+/-]{20,})/u;

export async function validateDistributionTree(rootInput) {
  const root = path.resolve(rootInput);
  const packageJson = object(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")), "package.json");
  if (packageJson.name !== "chat2codex" || typeof packageJson.version !== "string") throw new Error("Distribution package identity is invalid.");
  const manifestPath = path.join(root, "distribution", "release-manifest.json");
  const manifest = object(JSON.parse(await readFile(manifestPath, "utf8").catch(() => { throw new Error("Distribution release manifest is missing."); })), "release manifest");
  exactKeys(manifest, manifestKeys, "release manifest");
  if (manifest.schemaVersion !== 1 || manifest.packageVersion !== packageJson.version) throw new Error("Distribution release manifest package version is invalid.");
  if (manifest.node !== packageJson.engines?.node && packageJson.engines?.node !== undefined) throw new Error("Distribution Node range differs from package engines.");
  validateMatrix(manifest);
  const packageRoots = manifest.packageRoots;
  if (!Array.isArray(packageRoots) || packageRoots.length < 8 || packageRoots.length > 32 || !packageRoots.every((item) => typeof item === "string" && /^[A-Za-z0-9._-]+$/u.test(item)) || new Set(packageRoots).size !== packageRoots.length) throw new Error("Distribution package roots are invalid.");
  const provenance = manifest.provenance;
  if (!Array.isArray(provenance) || JSON.stringify(provenance) !== JSON.stringify(["LICENSE", "THIRD_PARTY_NOTICES.md", "package.json"])) throw new Error("Distribution provenance files are invalid.");
  for (const relative of provenance) await regular(root, relative);
  const requiredDocs = manifest.requiredDocs;
  if (!Array.isArray(requiredDocs) || requiredDocs.length !== 6) throw new Error("Distribution required docs list is invalid.");
  for (const relative of requiredDocs) await regular(root, relative).catch(() => { throw new Error(`Missing distribution docs: ${String(relative)}`); });
  const hooks = object(manifest.hooks, "Hook hashes");
  if (Object.keys(hooks).length !== 3) throw new Error("Distribution must declare exactly three Hook hashes.");
  for (const [relative, expected] of Object.entries(hooks)) {
    if (!/^scripts\/codex-hooks\/[a-z0-9-]+\.mjs$/u.test(relative) || typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected)) throw new Error("Distribution Hook hash entry is invalid.");
    const actual = createHash("sha256").update(await readFile(await regular(root, relative))).digest("hex");
    if (actual !== expected) throw new Error(`Hook hash mismatch: ${relative}`);
  }
  const roots = path.basename(root) === "package" ? packageRoots : ["package.json", ".env.example", "README.md", "README.zh-CN.md", "THIRD_PARTY_NOTICES.md", "distribution", "docs/architecture.md", "docs/codex-app-server-protocol", "docs/phase3", "docs/windows", "docs/quality/clean-windows-e2e-runbook.md", "scripts/codex-hooks"];
  const files = [];
  for (const relative of roots) await collect(root, relative, files);
  if (path.basename(root) === "package") {
    const actualRoots = (await readdir(root, { withFileTypes: true })).map((entry) => entry.name).sort();
    const expectedRoots = [...packageRoots].sort();
    if (JSON.stringify(actualRoots) !== JSON.stringify(expectedRoots)) throw new Error(`Undeclared packaged top-level content: expected ${expectedRoots.join(",")}; observed ${actualRoots.join(",")}`);
  }
  const hits = [];
  for (const filePath of files) {
    if (/\.(?:tgz|gz|png|jpg|jpeg|pdf)$/iu.test(filePath)) continue;
    let content = await readFile(filePath, "utf8");
    if (path.relative(root, filePath).replace(/\\/gu, "/") === "scripts/verify-distribution-package.mjs") {
      content = content.replace(/^const (?:forbiddenPath|secret) = .*?;\r?$/gmu, "");
    }
    if (forbiddenPath.test(content)) hits.push(`${path.relative(root, filePath)}: machine path`);
    if (secret.test(content)) hits.push(`${path.relative(root, filePath)}: secret pattern`);
  }
  if (hits.length) throw new Error(`Forbidden distribution path or secret: ${hits.slice(0, 8).join("; ")}`);
  return { packageVersion: packageJson.version, hookCount: Object.keys(hooks).length, forbiddenHits: 0, scannedFiles: new Set(files).size };
}

function validateMatrix(manifest) {
  const windows = object(manifest.windows, "Windows matrix"); exactKeys(windows, ["supported", "unverified"], "Windows matrix");
  if (JSON.stringify(windows.supported) !== JSON.stringify(["win32-x64"]) || JSON.stringify(windows.unverified) !== JSON.stringify(["win32-arm64"])) throw new Error("Distribution Windows support matrix is invalid.");
  const schemas = object(manifest.stateSchemas, "state schema matrix"); exactKeys(schemas, ["read", "write"], "state schema matrix");
  if (JSON.stringify(schemas.read) !== JSON.stringify([4,5,6]) || schemas.write !== 6) throw new Error("Distribution state schema matrix is invalid.");
  if (typeof manifest.codexCli !== "string" || typeof manifest.desktop !== "string") throw new Error("Distribution compatibility versions are invalid.");
}
async function regular(root, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.includes("..")) throw new Error("Distribution path is invalid.");
  const candidate = path.resolve(root, relative); const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink() || !same(await realpath(candidate), candidate)) throw new Error("Distribution asset must be a canonical regular file.");
  return candidate;
}
async function collect(root, relative, output) {
  const candidate = path.resolve(root, relative); const info = await lstat(candidate).catch(() => null); if (!info) return;
  if (info.isSymbolicLink()) throw new Error("Distribution symlink is forbidden.");
  if (info.isFile()) { output.push(candidate); return; }
  if (!info.isDirectory()) return;
  for (const entry of await readdir(candidate, { withFileTypes: true })) await collect(root, path.join(relative, entry.name), output);
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value; }
function exactKeys(value, allowed, label) { const unknown=Object.keys(value).filter((key)=>!allowed.includes(key)); const missing=allowed.filter((key)=>!Object.hasOwn(value,key)); if(unknown.length) throw new Error(`Unknown ${label} field.`); if(missing.length) throw new Error(`Missing ${label} field.`); }
function same(left, right) { return process.platform === "win32" ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right; }

async function main() { const selfRoot=path.resolve(fileURLToPath(new URL("..", import.meta.url))); const root=process.argv[2] ? path.resolve(process.argv[2]) : selfRoot; const result=await validateDistributionTree(root); process.stdout.write(`Distribution package valid: ${result.packageVersion}; hooks=${result.hookCount}; scanned=${result.scannedFiles}\n`); }
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error)=>{process.stderr.write(`distribution-package: ${error instanceof Error ? error.message : String(error)}\n`);process.exitCode=1;});
