import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";
import { processIdExists } from "../scripts/process-identity.mjs";

test("kills only after the durable boundary and recovers pending outbox without rerunning Codex", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-novice-restart-"));
  const statePath = path.join(root, "state.json");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    child = Bun.spawn(["node", "scripts/novice-restart-probe.mjs", "seed", statePath], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    const line = await readFirstLine(child.stdout, 4_000);
    expect(line).toStartWith("DURABLE_BOUNDARY state_saved ");
    const boundary = JSON.parse(line.slice(line.indexOf("{") ));
    expect(boundary.pid).toBe(child.pid);
    const identity = queryProcessIdentity(child.pid);
    expect(identity.pid).toBe(child.pid);
    expect(identity.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    child.kill();
    await child.exited;
    expect(processIdExists(identity.pid)).toBe(false);
    const recovered = Bun.spawnSync(["node", "scripts/novice-restart-probe.mjs", "recover", statePath], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    expect(recovered.exitCode).toBe(0);
    const result = JSON.parse(recovered.stdout.toString());
    expect(result.schemaVersion).toBe(6);
    expect(result.taskIds).toEqual(["task"]);
    expect(result.statuses).toEqual(["delivered", "pending"]);
    expect(result.recoveredIds).toEqual([result.deliveryIds[1]]);
    expect(result.codexRuns).toBe(1);
  } finally {
    if (child && processIdExists(child.pid)) { child.kill(); await child.exited; }
    await rm(root, { recursive: true, force: true });
  }
});

async function readFirstLine(stream: ReadableStream<Uint8Array>, deadlineMs: number): Promise<string> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let text = ""; let timer;
  try {
    while (!text.includes("\n")) {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("restart boundary deadline exceeded")), deadlineMs); }),
      ]);
      if (timer) clearTimeout(timer);
      if (result.done) throw new Error("restart probe exited before durable boundary");
      text += decoder.decode(result.value, { stream: true });
    }
    return text.slice(0, text.indexOf("\n"));
  } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
}
function queryProcessIdentity(pid: number): { pid: number; createdAt: string } {
  const command = "$p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "'; if(!$p){exit 3}; [pscustomobject]@{pid=[int]$p.ProcessId;createdAt=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress";
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("Could not query restart probe identity.");
  return JSON.parse(result.stdout.toString());
}
