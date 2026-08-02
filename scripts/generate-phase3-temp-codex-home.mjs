#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = requiredAbsolute(process.argv[2], "package root");
const codexHome = requiredAbsolute(process.argv[3], "temporary Codex Home");
const nodePath = requiredAbsolute(process.argv[4], "Node 24 executable");
if (!codexHome.toLowerCase().includes("chat2codex-phase3-temp-")) throw new Error("refusing a non-temporary Codex Home");

const manifest = JSON.parse(await readFile(path.join(packageRoot, "docs/phase3/hook-sha256.json"), "utf8"));
if (manifest.installation_status !== "UNTRUSTED_UNTIL_TASK_12_APPROVAL") throw new Error("invalid pre-install manifest");
const promptScript = quote(path.join(packageRoot, "scripts/codex-hooks/user-prompt-submit.mjs"));
const stopScript = quote(path.join(packageRoot, "scripts/codex-hooks/stop-wake.mjs"));
const node = quote(nodePath);
const promptEnvironment = process.platform === "win32"
  ? "$env:CHAT2CODEX_DESKTOP_GATEWAY_PORT='43127'; $env:CHAT2CODEX_DESKTOP_PROMPT_KEY_ID='phase3-temp-prompt'; $env:CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE='C:/phase3-temp/prompt.key'; "
  : "CHAT2CODEX_DESKTOP_GATEWAY_PORT='43127' CHAT2CODEX_DESKTOP_PROMPT_KEY_ID='phase3-temp-prompt' CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE='/phase3-temp/prompt.key' ";
const stopEnvironment = process.platform === "win32"
  ? "$env:CHAT2CODEX_DESKTOP_GATEWAY_PORT='43127'; $env:CHAT2CODEX_DESKTOP_STOP_KEY_ID='phase3-temp-stop'; $env:CHAT2CODEX_DESKTOP_STOP_TOKEN_FILE='C:/phase3-temp/stop.key'; "
  : "CHAT2CODEX_DESKTOP_GATEWAY_PORT='43127' CHAT2CODEX_DESKTOP_STOP_KEY_ID='phase3-temp-stop' CHAT2CODEX_DESKTOP_STOP_TOKEN_FILE='/phase3-temp/stop.key' ";
const config = [
  "# TEMPORARY PRE-INSTALL TEST ONLY. No token values. No production write.",
  "[hooks]",
  "",
  "[[hooks.UserPromptSubmit]]",
  "hooks = [{ type = \"command\", command = " + tomlString(promptEnvironment + (process.platform === "win32" ? "& " : "") + node + " " + promptScript) + ", commandWindows = " + tomlString(promptEnvironment + "& " + node + " " + promptScript) + ", async = false, timeoutSec = 3, statusMessage = \"Checking Chat2Codex Desktop ownership\" }]",
  "",
  "[[hooks.Stop]]",
  "hooks = [{ type = \"command\", command = " + tomlString(stopEnvironment + (process.platform === "win32" ? "& " : "") + node + " " + stopScript) + ", commandWindows = " + tomlString(stopEnvironment + "& " + node + " " + stopScript) + ", async = false, timeoutSec = 3, statusMessage = \"Waking Chat2Codex reconciliation\" }]",
  "",
  "[mcp_servers.chat2codex_desktop_gateway]",
  "command = " + tomlString(nodePath),
  "args = [" + tomlString(path.join(packageRoot, "dist/desktop-gateway/mcp.js")) + "]",
  "enabled = false",
  "",
].join("\n");
await mkdir(codexHome, { recursive: true });
await writeFile(path.join(codexHome, "config.toml"), config, { encoding: "utf8", flag: "wx" });
process.stdout.write(JSON.stringify({ codexHome, config: "config.toml", hooks: 2, mcpEnabled: false }) + "\n");

function requiredAbsolute(value, label) { if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(label + " must be absolute"); return path.resolve(value); }
function quote(value) { return "'" + value.replaceAll("'", "''") + "'"; }
function tomlString(value) { return JSON.stringify(value.replaceAll("\\", "/")); }
