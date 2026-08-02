import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import readline from "node:readline";

const cwd = path.resolve(process.argv[2] ?? process.cwd());
const codexBin = process.argv[3] ?? process.env.CODEX_BIN ?? "codex";
const isolatedCodexHome = process.argv[4] ? path.resolve(process.argv[4]) : undefined;

const child = spawn(codexBin, ["app-server", "--stdio"], {
  cwd,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
  env: isolatedCodexHome ? { ...process.env, CODEX_HOME: isolatedCodexHome } : process.env,
});
let sequence = 0;
let stderr = "";
const pending = new Map();

child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk.toString("utf8")).slice(-16_384);
});
child.once("exit", (code, signal) => {
  const error = new Error(`app-server exited code=${code} signal=${signal}; stderr=${stderr.trim()}`);
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
});

const lines = readline.createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (typeof message.id !== "number") return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
  else waiter.resolve(message.result);
});

function request(method, params, timeoutMs = 15_000) {
  const id = ++sequence;
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  return Promise.race([
    response,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${method}; stderr=${stderr.trim()}`)), timeoutMs)),
  ]);
}

function notify(method) {
  child.stdin.write(JSON.stringify({ method }) + "\n");
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function rows(value) {
  const object = record(value);
  for (const key of ["data", "items", "plugins", "hooks", "servers"]) {
    if (Array.isArray(object?.[key])) return object[key];
  }
  return [];
}

function suffix(value) {
  return createHash("sha256").update(value).digest("hex").slice(-8);
}

async function safe(method, params) {
  const started = Date.now();
  try {
    const result = await request(method, params);
    return { method, ok: true, durationMs: Date.now() - started, count: rows(result).length, keys: Object.keys(record(result) ?? {}).sort() };
  } catch (error) {
    return { method, ok: false, durationMs: Date.now() - started, error: error.message };
  }
}

try {
  const initialized = await request("initialize", {
    clientInfo: { name: "chat2codex-phase3-readonly-probe", title: "Phase 3 Read-only Probe", version: "0.0.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  notify("initialized");
  const results = [
    { method: "initialize", ok: true, keys: Object.keys(record(initialized) ?? {}).sort() },
    await safe("hooks/list", { cwds: [cwd] }),
    await safe("plugin/list", { cwds: [cwd], forceRefetch: false, marketplaceKinds: ["local"] }),
    await safe("plugin/installed", { cwds: [cwd], installSuggestionPluginNames: [] }),
    await safe("mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 50, threadId: null }),
  ];
  try {
    const listed = await request("thread/list", { cwd, limit: 10, sortDirection: "desc", archived: false });
    const listRows = rows(listed);
    results.push({ method: "thread/list", ok: true, count: listRows.length, keys: Object.keys(record(listed) ?? {}).sort() });
    const first = record(listRows[0]);
    const threadId = typeof first?.id === "string" ? first.id : undefined;
    if (threadId) {
      const read = await request("thread/read", { threadId, includeTurns: true });
      const thread = record(record(read)?.thread);
      results.push({
        method: "thread/read", ok: true, threadSuffix: suffix(threadId),
        responseKeys: Object.keys(record(read) ?? {}).sort(), threadKeys: Object.keys(thread ?? {}).sort(),
        turnCount: Array.isArray(thread?.turns) ? thread.turns.length : null,
      });
    } else {
      results.push({ method: "thread/read", ok: false, error: "no-existing-thread-in-probe-cwd" });
    }
  } catch (error) {
    results.push({ method: "thread/list-or-read", ok: false, error: error.message });
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), codexPid: child.pid, cwd, isolatedCodexHome, results }, null, 2));
} finally {
  lines.close();
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}
