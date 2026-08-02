import { pathToFileURL } from "node:url";

const [modulePath, statePath, adapterId, chat2codexHome] = process.argv.slice(2);
if (!modulePath || !statePath || !adapterId || !chat2codexHome) {
  throw new Error("Usage: node state-load-probe.mjs <store-module> <state-path> <adapter-id> <home>");
}

const { JsonStateStore } = await import(pathToFileURL(modulePath).href);
try {
  const state = await new JsonStateStore(statePath, {
    adapterId,
    chat2codexHome,
    jobRetentionCount: 1_000_000,
    outboxRetentionCount: 1_000_000,
  }).load();
  const tasks = Object.values(state.tasks ?? {});
  const threads = tasks.map((task) => task.threadId).filter(Boolean);
  console.log(JSON.stringify({
    ok: true,
    tasks: tasks.length,
    uniqueThreads: new Set(threads).size,
    jobs: Object.keys(state.jobs ?? {}).length,
    outbox: Object.keys(state.outbox ?? {}).length,
    pendingMessages: Object.keys(state.pendingMessages ?? {}).length,
  }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 2;
}
