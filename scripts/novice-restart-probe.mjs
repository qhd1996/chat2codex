import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { MediaOutbox } from "../dist/core/media-outbox.js";
import { JsonStateStore } from "../dist/state/store.js";
import { emptyState } from "../dist/state/types.js";

const [mode, stateInput] = process.argv.slice(2);
if ((mode !== "seed" && mode !== "recover") || !stateInput) throw new Error("Usage: node scripts/novice-restart-probe.mjs <seed|recover> <state-path>");
const statePath = path.resolve(stateInput);
const root = path.dirname(statePath);
const store = new JsonStateStore(statePath, { adapterId: "weixin:novice-restart", chat2codexHome: root });

if (mode === "seed") {
  const state = emptyState(); const at = "2026-08-02T00:00:00.000Z";
  state.tasks.task = { taskId: "task", conversationId: "conversation", chatType: "direct", senderKey: "synthetic", title: "restart", aliases: [], workspaceKind: "explicit", workspaceRoot: root, executionCwd: root, isolationMode: "canonical_fifo", sessionEpoch: "epoch", threadId: "root", status: "completed", objectiveSummary: "synthetic restart", recentRequests: ["codex_runs=1"], createdAt: at, updatedAt: at, lastActiveAt: at };
  state.conversations.conversation = { taskIds: ["task"], lastTaskId: "task" };
  const job = { id: "job", kind: "codex_run", messageId: "message", chatId: "conversation", chatType: "direct", cwd: root, prompt: "synthetic", threadId: "root", status: "completed", createdAt: at, updatedAt: at, completedAt: at, deliveryIds: [], taskId: "task" };
  state.jobs.job = job;
  const items = new MediaOutbox().appendResult(state, job, { textEntries: [{ kind: "text", text: "one" }, { kind: "text", text: "two" }], createdAt: at });
  items[0].status = "delivered"; items[0].deliveredAt = at; items[1].status = "sending";
  await store.save(state);
  const hash = createHash("sha256").update(await readFile(statePath)).digest("hex");
  process.stdout.write("DURABLE_BOUNDARY state_saved " + JSON.stringify({ pid: process.pid, createdAt: new Date(performance.timeOrigin).toISOString(), stateHash: hash }) + "\n");
  await new Promise((resolve) => {
    const keepAlive = setInterval(() => undefined, 60_000);
    const finish = () => { clearInterval(keepAlive); resolve(); };
    process.once("SIGTERM", finish);
    process.once("SIGINT", finish);
  });
} else {
  const state = await store.load();
  const recovered = new MediaOutbox().recover(state);
  process.stdout.write(JSON.stringify({
    schemaVersion: JSON.parse(await readFile(statePath, "utf8")).schemaVersion,
    taskIds: Object.keys(state.tasks).sort(),
    deliveryIds: Object.values(state.outbox).sort((a, b) => a.sequence - b.sequence).map((item) => item.id),
    statuses: Object.values(state.outbox).sort((a, b) => a.sequence - b.sequence).map((item) => item.status),
    recoveredIds: recovered.map((item) => item.id), codexRuns: 1,
  }) + "\n");
}
