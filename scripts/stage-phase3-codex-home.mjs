#!/usr/bin/env node
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STAGED_FILES = Object.freeze([
  ["docs/phase3/codex-config.phase3.patch.toml", "config.phase3.toml"],
  ["docs/phase3/codex-hooks.example.json", "hooks.phase3.json"],
  ["docs/phase3/hook-sha256.json", "hook-sha256.json"],
]);

export async function stagePhase3CodexHome({ packageRoot, codexHome, realCodexHome }) {
  const sourceRoot = requiredAbsolute(packageRoot, "package root");
  const targetHome = requiredAbsolute(codexHome, "temporary Codex Home");
  const protectedHome = requiredAbsolute(realCodexHome, "real Codex Home");
  if (samePath(targetHome, protectedHome)) throw new Error("staging refuses the real Codex Home");
  if (!isWithin(targetHome, path.resolve(os.tmpdir()))) throw new Error("staging requires a Codex Home below the operating-system temporary directory");

  const staging = path.join(targetHome, "phase3-staging");
  await assertMissing(staging);
  for (const [source] of STAGED_FILES) await access(path.join(sourceRoot, source));
  await verifyManifest(sourceRoot);
  await mkdir(staging, { recursive: true });
  for (const [source, target] of STAGED_FILES) await copyFile(path.join(sourceRoot, source), path.join(staging, target));
  await writeFile(path.join(staging, "README.txt"), [
    "PHASE 3 TEMPORARY CODEX HOME - NOT INSTALLED OR TRUSTED",
    "",
    "These inert files are staged for repository-only verification.",
    "They do not contain token values and do not modify the active Codex Home.",
    "Do not copy, trust, enable, or restart anything without Task 12 approval.",
    "",
  ].join("\n"), "utf8");
  return {
    codexHome: targetHome,
    enabled: false,
    created: ["README.txt", ...STAGED_FILES.map(([, target]) => target)].map((entry) => "phase3-staging/" + entry),
  };
}

async function verifyManifest(sourceRoot) {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "docs/phase3/hook-sha256.json"), "utf8"));
  if (manifest.installation_status !== "UNTRUSTED_UNTIL_TASK_12_APPROVAL") throw new Error("Hook manifest is not pre-install only");
}

function requiredAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(label + " must be an absolute path");
  return path.resolve(value);
}

function normalize(value) { return process.platform === "win32" ? value.toLowerCase() : value; }
function samePath(left, right) { return normalize(left) === normalize(right); }
function isWithin(child, parent) { const relative = path.relative(parent, child); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); }
async function assertMissing(target) { try { await access(target); throw new Error("staging target already exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; } }

async function main(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  const result = await stagePhase3CodexHome({
    packageRoot: values.get("--package-root"),
    codexHome: values.get("--codex-home"),
    realCodexHome: values.get("--real-codex-home"),
  });
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
