import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { config as loadDotenv } from "dotenv";
import { acquireBridgeInstanceLock } from "../dist/state/instance-lock.js";

if (process.argv[2] !== "start") throw new Error("Novice service probe requires the explicit start command.");
const envFile = process.env.CHAT2CODEX_ENV;
if (!envFile || !path.isAbsolute(envFile)) throw new Error("Novice service probe requires an absolute env file.");
loadDotenv({ path: envFile, override: true, quiet: true });
if (process.env.CHAT2CODEX_NOVICE_SERVICE_PROBE !== "1") throw new Error("Novice service probe marker is missing.");
const statePath = path.resolve(process.env.BRIDGE_STATE_PATH ?? "");
const readyPath = path.resolve(process.env.CHAT2CODEX_NOVICE_SERVICE_READY_PATH ?? "");
const stopPath = path.resolve(process.env.CHAT2CODEX_NOVICE_SERVICE_STOP_PATH ?? "");
const home = path.resolve(process.env.CHAT2CODEX_HOME ?? "");
for (const candidate of [statePath, readyPath, stopPath]) if (!inside(home, candidate)) throw new Error("Novice service probe path escaped its owned home.");
await mkdir(path.dirname(statePath), { recursive: true });
const state = await readFile(statePath, "utf8").catch(() => "");
if (!state) await writeFile(statePath, JSON.stringify({ schemaVersion: 6, adapters: {} }, null, 2) + "\n", { flag: "wx" });
const lock = await acquireBridgeInstanceLock(statePath);
await writeFile(readyPath, JSON.stringify({ pid: process.pid, stateSha256: createHash("sha256").update(await readFile(statePath)).digest("hex") }) + "\n", { flag: "w" });
await new Promise((resolve) => {
  let finishing = false;
  const finish = () => { if (finishing) return; finishing = true; clearInterval(keepAlive); resolve(); };
  const keepAlive = setInterval(async () => { if (await readFile(stopPath).then(() => true).catch(() => false)) finish(); }, 50);
  process.once("SIGTERM", finish);
  process.once("SIGINT", finish);
});
await lock.release();

function inside(root, candidate) { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
