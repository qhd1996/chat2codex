import { createHash } from "node:crypto";
import path from "node:path";

type Json = Record<string, unknown>;

const cwd = path.resolve(process.argv[2] ?? process.cwd());
const codexBin = process.argv[3] ?? process.env.CODEX_BIN ?? "codex";
const disabledMcps = [
  "openaiDeveloperDocs", "westock", "tencent_docs", "baidu_netdisk", "email",
  "weixinpay", "zsxq-topic", "ardot", "github",
].flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`]);

const child = Bun.spawn([codexBin, "app-server", ...disabledMcps, "--stdio"], {
  cwd,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

let sequence = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let buffered = "";
function receive(line: string): void {
  const message = JSON.parse(line) as Json;
  if (typeof message.id !== "number") return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  const error = message.error as Json | undefined;
  if (error) waiter.reject(new Error(`${String(error.code ?? "?")}: ${String(error.message ?? "unknown")}`));
  else waiter.resolve(message.result);
}

const outputTask = (async () => {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split(/\r?\n/u);
      buffered = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) receive(line);
    }
    buffered += decoder.decode();
    if (buffered.trim()) receive(buffered);
  } finally {
    reader.releaseLock();
  }
})();

function request(method: string, params: Json, timeoutMs = 15_000): Promise<unknown> {
  const id = ++sequence;
  const response = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  return Promise.race([
    response,
    Bun.sleep(timeoutMs).then(() => { throw new Error(`timeout:${method}`); }),
  ]);
}

function notification(method: string): void {
  child.stdin.write(JSON.stringify({ method }) + "\n");
}

function asRecord(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : undefined;
}

function rows(value: unknown): unknown[] {
  const record = asRecord(value);
  for (const key of ["data", "items", "plugins", "hooks", "servers"]) {
    if (Array.isArray(record?.[key])) return record[key];
  }
  return [];
}

function suffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(-8);
}

async function safe(method: string, params: Json): Promise<Json> {
  const started = Date.now();
  try {
    const result = await request(method, params);
    return { method, ok: true, durationMs: Date.now() - started, count: rows(result).length, keys: Object.keys(asRecord(result) ?? {}).sort() };
  } catch (error) {
    return { method, ok: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

try {
  const initialized = await request("initialize", {
    clientInfo: { name: "chat2codex-phase3-readonly-probe", title: "Phase 3 Read-only Probe", version: "0.0.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  notification("initialized");

  const results: Json[] = [
    { method: "initialize", ok: true, keys: Object.keys(asRecord(initialized) ?? {}).sort() },
    await safe("hooks/list", { cwds: [cwd] }),
    await safe("plugin/list", { cwds: [cwd], forceRefetch: false, marketplaceKinds: ["local"] }),
    await safe("plugin/installed", { cwds: [cwd], installSuggestionPluginNames: [] }),
    await safe("mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 50, threadId: null }),
  ];

  try {
    const listed = await request("thread/list", { cwd, limit: 10, sortDirection: "desc", archived: false });
    const listRows = rows(listed);
    results.push({ method: "thread/list", ok: true, count: listRows.length, keys: Object.keys(asRecord(listed) ?? {}).sort() });
    const first = asRecord(listRows[0]);
    const threadId = typeof first?.id === "string" ? first.id : undefined;
    if (threadId) {
      const read = await request("thread/read", { threadId, includeTurns: true });
      const thread = asRecord(asRecord(read)?.thread);
      results.push({
        method: "thread/read", ok: true, threadSuffix: suffix(threadId),
        responseKeys: Object.keys(asRecord(read) ?? {}).sort(), threadKeys: Object.keys(thread ?? {}).sort(),
        turnCount: Array.isArray(thread?.turns) ? thread.turns.length : null,
      });
    } else {
      results.push({ method: "thread/read", ok: false, error: "no-existing-thread-in-probe-cwd" });
    }
  } catch (error) {
    results.push({ method: "thread/list-or-read", ok: false, error: error instanceof Error ? error.message : String(error) });
  }

  console.log(JSON.stringify({ at: new Date().toISOString(), codexPid: child.pid, cwd, results }, null, 2));
} finally {
  child.kill();
  await Promise.race([Promise.allSettled([child.exited, outputTask]), Bun.sleep(5_000)]);
}
