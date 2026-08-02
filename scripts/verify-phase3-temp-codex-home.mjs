#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

const codexBin = requiredAbsolute(process.argv[2], "Codex binary");
const codexHome = requiredAbsolute(process.argv[3], "temporary Codex Home");
const cwd = requiredAbsolute(process.argv[4] ?? process.cwd(), "working directory");
if (!codexHome.toLowerCase().includes("chat2codex-phase3-temp-")) throw new Error("refusing a non-temporary Codex Home");

const child = spawn(codexBin, ["app-server", "--stdio", "--strict-config"], {
  cwd,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, CODEX_HOME: codexHome },
});
let id = 0;
let stderr = "";
const pending = new Map();
child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-8192); });
child.once("exit", (code, signal) => {
  const error = new Error("app-server exited code=" + code + " signal=" + signal + "; stderr=" + stderr.trim());
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
});
const lines = readline.createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(message.error.code + ": " + message.error.message)) : waiter.resolve(message.result);
});
function request(method, params) {
  const requestId = ++id;
  const response = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
  child.stdin.write(JSON.stringify({ id: requestId, method, params }) + "\n");
  return Promise.race([response, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout:" + method)), 15_000))]);
}

try {
  const initialized = await request("initialize", { clientInfo: { name: "chat2codex-phase3-temp-home", title: "Phase 3 Temp Home", version: "0.0.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const hooks = await request("hooks/list", { cwds: [cwd] });
  const mcp = await request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 50, threadId: null });
  const reportedHome = initialized?.codexHome;
  if (path.resolve(reportedHome).toLowerCase() !== codexHome.toLowerCase()) throw new Error("app-server did not use the temporary Codex Home");
  const hookEntries = hooks?.data ?? [];
  const mcpRows = mcp?.data ?? [];
  const hooksCount = hookEntries.reduce((count, entry) => count + (Array.isArray(entry?.hooks) ? entry.hooks.length : 0), 0);
  const hookErrors = hookEntries.reduce((count, entry) => count + (Array.isArray(entry?.errors) ? entry.errors.length : 0), 0);
  const hookWarnings = hookEntries.reduce((count, entry) => count + (Array.isArray(entry?.warnings) ? entry.warnings.length : 0), 0);
  const events = hookEntries.flatMap((entry) => Array.isArray(entry?.hooks) ? entry.hooks.map((hook) => hook?.eventName) : []).sort();
  const trustStatuses = hookEntries.flatMap((entry) => Array.isArray(entry?.hooks) ? entry.hooks.map((hook) => hook?.trustStatus) : []).sort();
  if (hooksCount !== 2 || hookErrors !== 0 || events.join(",") !== "stop,userPromptSubmit") throw new Error("temporary Codex Home did not load exactly the inert Phase 3 Hooks");
  if (trustStatuses.some((status) => status !== "untrusted")) throw new Error("temporary Phase 3 Hooks unexpectedly became trusted");
  if (mcpRows.length !== 1 || mcpRows[0]?.name !== "chat2codex_desktop_gateway" || mcpRows[0]?.serverInfo != null || Object.keys(mcpRows[0]?.tools ?? {}).length !== 0 || (mcpRows[0]?.resources ?? []).length !== 0 || (mcpRows[0]?.resourceTemplates ?? []).length !== 0) throw new Error("temporary MCP definition was missing or unexpectedly started");
  process.stdout.write(JSON.stringify({ codexHome, hooks: hooksCount, events, trustStatuses, hookErrors, hookWarnings, mcpDefinitions: 1, mcpStarted: false, config: "strict", pluginDiscoveryUsed: false }) + "\n");
} finally {
  lines.close();
  child.kill();
}

function requiredAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(label + " must be absolute");
  return path.resolve(value);
}
