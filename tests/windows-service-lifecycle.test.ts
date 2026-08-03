import { describe, expect, test } from "bun:test";

import { assertCanonicalWindowsOwnedPath, installWindowsUserTask, uninstallWindowsUserTask, type WindowsServiceIo } from "../src/setup/windows-service.js";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const home = "C:\\Users\\Example\\.chat2codex";
const gatewayKeyFiles = ["prompt-hook.key", "stop-hook.key", "desktop-mcp.key"].map((name) => `${home}\\.secrets\\desktop-gateway\\${name}`);
const input = {
  home, envFile: `${home}\\.env`, launcherPath: `${home}\\.service\\windows\\launcher.ps1`,
  taskXmlPath: `${home}\\.service\\windows\\task.xml`, manifestPath: `${home}\\.service\\windows\\installation.json`,
  nodeBin: "C:\\Program Files\\nodejs\\node.exe", entrypoint: "C:\\Users\\Example\\AppData\\Roaming\\npm\\node_modules\\chat2codex\\dist\\index.js",
  logFile: `${home}\\.data\\logs\\service.log`, pathEnv: "C:\\Program Files\\nodejs;C:\\Windows\\System32", taskName: "Chat2Codex",
  statePath: `${home}\\.data\\state.json`,
};

describe("Windows service lifecycle executor", () => {
  test("writes verified owned files before exact task registration and query", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
    const result = await installWindowsUserTask(input, fixture.io);
    expect(result.taskPath).toBe("\\Chat2Codex\\Chat2Codex");
    expect(fixture.events.slice(-2)).toEqual([
      ["run", "schtasks.exe", ["/Create", "/TN", "\\Chat2Codex\\Chat2Codex", "/XML", input.taskXmlPath, "/F"]],
      ["run", "schtasks.exe", ["/Query", "/TN", "\\Chat2Codex\\Chat2Codex", "/XML"]],
    ]);
    const firstRun = fixture.events.findIndex((event) => event[0] === "run");
    expect(fixture.events.slice(0, firstRun).filter((event) => event[0] === "write").map((event) => event[1])).toContainAllValues([input.envFile, input.launcherPath, input.taskXmlPath, input.manifestPath]);
    const lastWrite = fixture.events.map((event) => event[0]).lastIndexOf("write");
    expect(fixture.events.slice(lastWrite + 1, firstRun).filter((event) => event[0] === "read").map((event) => event[1])).toContainAllValues([input.envFile, input.launcherPath, input.taskXmlPath, input.manifestPath]);
    expect(fixture.files.get(input.envFile)).toContain("USER_SETTING=yes");
    expect(fixture.files.get(input.envFile)).toContain("CHAT2CODEX_DESKTOP_GATEWAY_ENABLED=true");
    expect(fixture.files.get(input.envFile)).toContain(`CHAT2CODEX_HOME=${JSON.stringify(home)}`);
    expect(fixture.files.get(input.envFile)).toContain(`BRIDGE_STATE_PATH=${JSON.stringify(input.statePath)}`);
    expect(fixture.files.get(input.envFile)).toContain(`ATTACHMENT_DOWNLOAD_DIR=${JSON.stringify(`${home}\\.data\\attachments`)}`);
    expect(JSON.stringify(result)).not.toContain("secret-material");
  });

  test("repeating an identical installed task is a verified no-op", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
    await installWindowsUserTask(input, fixture.io);
    fixture.setKeyMode("preserved");
    fixture.events.length = 0;

    const second = await installWindowsUserTask(input, fixture.io);

    expect(second.createdKeys).toBe(0);
    expect(fixture.events.filter((event) => event[0] === "write")).toEqual([]);
    expect(fixture.events.filter((event) => event[0] === "run" && (event[2] as string[])[0] === "/Create")).toEqual([]);
    expect(fixture.events.some((event) => event[0] === "run" && (event[2] as string[])[0] === "/Query")).toBeTrue();
  });

  test("restores prior owned files and unregisters after task verification failure", async () => {
    const oldTask = "<Task><Actions><Exec><Arguments>-File &apos;" + input.launcherPath + "&apos;</Arguments></Exec></Actions></Task>";
    const prior = { [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: oldTask, [input.manifestPath]: JSON.stringify(priorManifestFor("old launcher", oldTask)) };
    let queryCount = 0;
    const fixture = ioFixture(prior, (args) => args[0] === "/Query" && ++queryCount === 2 ? new Error("query failed") : undefined);
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/query failed/i);
    expect(fixture.events).toContainEqual(["run", "schtasks.exe", ["/Delete", "/TN", "\\Chat2Codex\\Chat2Codex", "/F"]]);
    for (const [file, content] of Object.entries(prior)) expect(fixture.files.get(file)).toBe(content);
    expect(fixture.files.get(input.taskXmlPath)).toBe(prior[input.taskXmlPath]);
  });

  test("restores the prior registered task after an upgrade verification failure", async () => {
    const oldTask = "<Task><Actions><Exec><Arguments>-File &apos;" + input.launcherPath + "&apos;</Arguments></Exec></Actions></Task>";
    const prior = { [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: oldTask, [input.manifestPath]: JSON.stringify(priorManifestFor("old launcher", oldTask)) };
    let queried = 0;
    const fixture = ioFixture(prior, (args) => { if (args[0] === "/Query" && ++queried === 2) return new Error("query failed"); return undefined; });
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/query failed/i);
    const creates = fixture.events.filter((event) => event[0] === "run" && (event[2] as string[])[0] === "/Create");
    expect(creates).toHaveLength(2);
    expect(creates.at(-1)).toEqual(["run", "schtasks.exe", ["/Create", "/TN", "\\Chat2Codex\\Chat2Codex", "/XML", input.taskXmlPath, "/F"]]);
  });

  test("cleans a task whose create result is uncertain", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" }, (args) => args[0] === "/Create" ? new Error("create result uncertain") : undefined);
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/uncertain/i);
    expect(fixture.events).toContainEqual(["run", "schtasks.exe", ["/Delete", "/TN", "\\Chat2Codex\\Chat2Codex", "/F"]]);
  });

  test("preserves the original create failure when delete reports an already absent task", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" }, (args) => args[0] === "/Create" ? new Error("create result uncertain") : args[0] === "/Delete" ? new Error("delete rollback failed") : undefined);
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/^create result uncertain$/i);
    expect(fixture.events).toContainEqual(["task-exists", "\\Chat2Codex\\Chat2Codex"]);
  });

  test("fails closed when a failed rollback delete leaves the uncertain task present", async () => {
    let fixture: ReturnType<typeof ioFixture>;
    fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" }, (args) => {
      if (args[0] === "/Create") { fixture.setTaskExists(true); return new Error("create result uncertain"); }
      return args[0] === "/Delete" ? new Error("delete rollback failed") : undefined;
    });
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/rollback.*incomplete|delete rollback failed/i);
  });

  test("fails closed when task absence cannot be verified after a failed rollback delete", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" }, (args) => args[0] === "/Create" ? new Error("create result uncertain") : args[0] === "/Delete" ? new Error("delete rollback failed") : undefined);
    const taskExists = fixture.io.taskExists;
    let queryCount = 0;
    fixture.io.taskExists = async (taskPath) => {
      if (++queryCount === 2) throw new Error("task state uncertain");
      return taskExists(taskPath);
    };
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/rollback.*incomplete|task state uncertain/i);
  });

  test("fails closed when a successful rollback delete leaves the uncertain task visible", async () => {
    let fixture: ReturnType<typeof ioFixture>;
    fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" }, (args) => {
      if (args[0] === "/Create") { fixture.setTaskExists(true); return new Error("create result uncertain"); }
      return undefined;
    });
    fixture.keepTaskAfterDelete();
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/rollback.*incomplete|task remained/i);
  });

  test("rejects a task-name change before creating a second writer", async () => {
    const changed = { ...input, taskName: "Chat2Codex-New" };
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n", [input.manifestPath]: JSON.stringify(priorManifest()) });
    await expect(installWindowsUserTask(changed, fixture.io)).rejects.toThrow(/task name|prior.*task|writer/i);
    expect(fixture.events.some((event) => event[0] === "run" && (event[2] as string[])[0] === "/Create")).toBe(false);
  });

  test("rejects an upgrade before mutation when prior task rollback material is incomplete", async () => {
    for (const missing of [input.launcherPath, input.taskXmlPath]) {
      const prior: Record<string, string> = { [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: "old task", [input.manifestPath]: JSON.stringify(priorManifestFor("old launcher", "old task")) };
      delete prior[missing];
      const fixture = ioFixture(prior);
      await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/rollback material|prior.*missing/i);
      expect(fixture.events.some((event) => event[0] === "write" || event[0] === "run")).toBe(false);
    }
  });

  test("rejects an upgrade before mutation when prior owned bytes differ from manifest hashes", async () => {
    const manifest = priorManifest();
    manifest.hashes = { "launcher.ps1": "0".repeat(64), "task.xml": "1".repeat(64) };
    const prior = { [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: "old task", [input.manifestPath]: JSON.stringify(manifest) };
    const fixture = ioFixture(prior);
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/hash|rollback material|drift/i);
    expect(fixture.events.some((event) => event[0] === "write" || event[0] === "stop-writers" || (event[0] === "run" && (event[2] as string[])[0] === "/Create"))).toBe(false);
  });

  test("stops the exact old writer before the first upgrade mutation", async () => {
    const priorTask = "<Task><Actions><Exec><Arguments>-File &apos;" + input.launcherPath + "&apos;</Arguments></Exec></Actions></Task>";
    const manifest = priorManifestFor("old launcher", priorTask);
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: priorTask, [input.manifestPath]: JSON.stringify(manifest), [input.statePath]: '{"schemaVersion":6}' });
    fixture.setQueryXml(priorTask);
    fixture.setWriters(1);
    await installWindowsUserTask(input, fixture.io);
    const stopped = fixture.events.findIndex((event) => event[0] === "stop-writers");
    const firstWrite = fixture.events.findIndex((event) => event[0] === "write");
    expect(stopped).toBeGreaterThan(-1);
    expect(stopped).toBeLessThan(firstWrite);
    expect(fixture.events[stopped]).toEqual(["stop-writers", manifest.entrypoint]);
  });

  test("starts and verifies the replacement writer after an online upgrade succeeds", async () => {
    const priorTask = "<Task><Actions><Exec><Arguments>-File &apos;" + input.launcherPath + "&apos;</Arguments></Exec></Actions></Task>";
    const manifest = priorManifestFor("old launcher", priorTask);
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: priorTask, [input.manifestPath]: JSON.stringify(manifest), [input.statePath]: '{"schemaVersion":6}' });
    fixture.setQueryXml(priorTask);
    fixture.setWriters(1);
    await installWindowsUserTask(input, fixture.io);
    expect(fixture.events).toContainEqual(["start-and-verify-task", "\\Chat2Codex\\Chat2Codex", input.entrypoint, input.statePath]);
    expect(fixture.writerCount()).toBe(1);
    expect(fixture.writerEntrypoint()).toBe(input.entrypoint);
  });

  test("rejects an orphaned old writer before mutation when no managed task can restart it", async () => {
    const priorTask = "<Task><Actions><Exec><Arguments>-File &apos;" + input.launcherPath + "&apos;</Arguments></Exec></Actions></Task>";
    const manifest = priorManifestFor("old launcher", priorTask);
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: priorTask, [input.manifestPath]: JSON.stringify(manifest), [input.statePath]: '{"schemaVersion":6}' });
    fixture.setTaskExists(false);
    fixture.setWriters(1);
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/orphan|writer|task/i);
    expect(fixture.events.some((event) => event[0] === "stop-writers" || event[0] === "write")).toBe(false);
  });

  test("restores and restarts the exact prior writer when upgrade mutation fails", async () => {
    const priorTask = "<Task><Actions><Exec><Arguments>-File &apos;" + input.launcherPath + "&apos;</Arguments></Exec></Actions></Task>";
    const manifest = priorManifestFor("old launcher", priorTask);
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: priorTask, [input.manifestPath]: JSON.stringify(manifest), [input.statePath]: '{"schemaVersion":6}' });
    fixture.setQueryXml(priorTask);
    fixture.setWriters(1);
    fixture.failWriteOnce(input.envFile);
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/write failed/i);
    expect(fixture.events).toContainEqual(["start-and-verify-task", "\\Chat2Codex\\Chat2Codex", manifest.entrypoint, manifest.statePath]);
    expect(fixture.writerCount()).toBe(1);
    expect(fixture.files.get(input.launcherPath)).toBe("old launcher");
    expect(fixture.files.get(input.taskXmlPath)).toBe(priorTask);
  });

  test("stops an unhealthy replacement and verifies the restored prior writer", async () => {
    const priorTask = "<Task><Actions><Exec><Arguments>-File &apos;" + input.launcherPath + "&apos;</Arguments></Exec></Actions></Task>";
    const manifest = priorManifestFor("old launcher", priorTask);
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: priorTask, [input.manifestPath]: JSON.stringify(manifest), [input.statePath]: '{"schemaVersion":6}' });
    fixture.setQueryXml(priorTask);
    fixture.setWriters(1);
    fixture.failStartOnce(input.entrypoint);
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/replacement writer unhealthy/i);
    const failedStart = fixture.events.findIndex((event) => event[0] === "start-and-verify-task" && event[2] === input.entrypoint);
    const stoppedReplacement = fixture.events.findIndex((event, index) => index > failedStart && event[0] === "stop-writers" && event[1] === input.entrypoint);
    const restoredStart = fixture.events.findIndex((event, index) => index > stoppedReplacement && event[0] === "start-and-verify-task" && event[2] === manifest.entrypoint);
    expect(failedStart).toBeGreaterThan(-1);
    expect(stoppedReplacement).toBeGreaterThan(failedStart);
    expect(restoredStart).toBeGreaterThan(stoppedReplacement);
    expect(fixture.writerEntrypoint()).toBe(manifest.entrypoint);
  });

  test("refuses an unmanaged same-name task and a drifted managed task before mutation", async () => {
    const unmanaged = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
    unmanaged.setTaskExists(true);
    await expect(installWindowsUserTask(input, unmanaged.io)).rejects.toThrow(/unmanaged|ownership|manifest/i);
    expect(unmanaged.events.some((event) => event[0] === "write" || event[0] === "run")).toBe(false);

    const prior = { [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: "old task", [input.manifestPath]: JSON.stringify(priorManifestFor("old launcher", "old task")) };
    const drifted = ioFixture(prior);
    drifted.setQueryXml("<Task><Actions><Exec><Arguments>-File &apos;C:\\other\\launcher.ps1&apos;</Arguments></Exec></Actions></Task>");
    await expect(installWindowsUserTask(input, drifted.io)).rejects.toThrow(/prior.*task|launcher.*differs|ownership/i);
    expect(drifted.events.some((event) => event[0] === "write" || (event[0] === "run" && (event[2] as string[])[0] === "/Create"))).toBe(false);
  });

  test("does not create a prior task during rollback when it was absent before upgrade", async () => {
    const prior = { [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: "old task", [input.manifestPath]: JSON.stringify(priorManifestFor("old launcher", "old task")) };
    let createCount = 0;
    const fixture = ioFixture(prior, (args) => args[0] === "/Create" && ++createCount === 1 ? new Error("create failed") : undefined);
    fixture.setTaskExists(false);
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/create failed/i);
    expect(fixture.events.filter((event) => event[0] === "run" && (event[2] as string[])[0] === "/Create")).toHaveLength(1);
  });

  test("rejects a queried task whose launcher action differs", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
    fixture.setQueryXml("<Task><Actions><Exec><Arguments>-File &apos;C:\\wrong.ps1&apos;</Arguments></Exec></Actions></Task>");
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/wrong|launcher|query/i);
  });

  test("accepts both current Windows-quoted and legacy PowerShell-quoted launcher actions during upgrade", async () => {
    for (const argumentsXml of [
      `-File &quot;${input.launcherPath}&quot;`,
      `-File &apos;${input.launcherPath}&apos;`,
    ]) {
      const oldTask = `<Task><Actions><Exec><Arguments>${argumentsXml}</Arguments></Exec></Actions></Task>`;
      const prior = { [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: oldTask, [input.manifestPath]: JSON.stringify(priorManifestFor("old launcher", oldTask)) };
      const fixture = ioFixture(prior);
      fixture.setQueryXml(prior[input.taskXmlPath]);
      await expect(installWindowsUserTask(input, fixture.io)).resolves.toMatchObject({ taskPath: "\\Chat2Codex\\Chat2Codex" });
    }
  });

  test("uninstall removes exact owned files and managed env while preserving user data", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n# BEGIN CHAT2CODEX WINDOWS MANAGED\r\nA=b\r\n# END CHAT2CODEX WINDOWS MANAGED\r\n" });
    await installWindowsUserTask(input, fixture.io);
    fixture.files.set(`${home}\\.data\\state.json`, "durable");
    await expect(uninstallWindowsUserTask(input.manifestPath, fixture.io)).resolves.toEqual({ removed: true });
    await expect(uninstallWindowsUserTask(input.manifestPath, fixture.io)).resolves.toEqual({ removed: false });
    expect(fixture.events).toContainEqual(["run", "schtasks.exe", ["/Delete", "/TN", "\\Chat2Codex\\Chat2Codex", "/F"]]);
    expect(fixture.files.get(input.envFile)).toBe("USER_SETTING=yes\r\n");
    expect(fixture.files.get(`${home}\\.data\\state.json`)).toBe("durable");
    expect(fixture.files.has(input.launcherPath)).toBe(false);
    expect(fixture.files.has(input.manifestPath)).toBe(false);
    expect(fixture.events.filter((event) => event[0] === "run" && (event[2] as string[])[0] === "/Delete")).toHaveLength(1);
  });

  test("uninstall rejects a drifted same-name task before stop, deletion, or file mutation", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
    await installWindowsUserTask(input, fixture.io);
    fixture.setQueryXml("<Task><Actions><Exec><Arguments>-File &apos;C:\\other\\launcher.ps1&apos;</Arguments></Exec></Actions></Task>");
    const boundary = fixture.events.length;
    await expect(uninstallWindowsUserTask(input.manifestPath, fixture.io)).rejects.toThrow(/launcher|ownership|drift|task/i);
    expect(fixture.events.slice(boundary).some((event) => event[0] === "stop-writers" || event[0] === "remove" || (event[0] === "run" && (event[2] as string[])[0] === "/Delete"))).toBe(false);
    expect(fixture.files.has(input.manifestPath)).toBe(true);
  });

  test("keeps the manifest until every uninstall step succeeds so cleanup is retryable", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
    await installWindowsUserTask(input, fixture.io);
    fixture.failRemoveOnce(gatewayKeyFiles[0]!);
    await expect(uninstallWindowsUserTask(input.manifestPath, fixture.io)).rejects.toThrow(/remove failed/i);
    expect(fixture.files.has(input.manifestPath)).toBe(true);
    await expect(uninstallWindowsUserTask(input.manifestPath, fixture.io)).resolves.toEqual({ removed: true });
    expect(fixture.files.has(input.manifestPath)).toBe(false);
  });

  test("preserves preexisting non-owned keys across install and uninstall", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" }, () => undefined, "preserved");
    await installWindowsUserTask(input, fixture.io);
    await uninstallWindowsUserTask(input.manifestPath, fixture.io);
    for (const file of Object.values(fixture.keyPaths)) expect(fixture.files.get(file)).toBe("preexisting-key");
  });

  test("retains installer ownership of keys across an upgrade before uninstall", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
    await installWindowsUserTask(input, fixture.io);
    fixture.setKeyMode("preserved");
    await installWindowsUserTask(input, fixture.io);
    await uninstallWindowsUserTask(input.manifestPath, fixture.io);
    for (const file of Object.values(fixture.keyPaths)) expect(fixture.files.has(file)).toBe(false);
  });

  test("writes a hash-recorded rollback snapshot before an upgrade", async () => {
    const oldTask = "<Task><Actions><Exec><Arguments>-File &apos;" + input.launcherPath + "&apos;</Arguments></Exec></Actions></Task>";
    const oldManifest = priorManifestFor("old launcher", oldTask);
    const fixture = ioFixture({ [input.envFile]: "CUSTOM_STATE=yes\r\nBRIDGE_STATE_PATH=C:\\Custom\\state.json\r\n", [input.launcherPath]: "old launcher", [input.taskXmlPath]: oldTask, [input.manifestPath]: JSON.stringify(oldManifest), [input.statePath]: "{\"schemaVersion\":6}" });
    await installWindowsUserTask(input, fixture.io);
    const rollbackWrites = fixture.events.filter((event) => event[0] === "write" && String(event[1]).includes("\\rollback\\"));
    expect(rollbackWrites.length).toBeGreaterThanOrEqual(3);
    const recordPath = rollbackWrites.map((event) => String(event[1])).find((file) => file.endsWith("backup.json"));
    expect(recordPath).toBeDefined();
    expect(fixture.files.get(recordPath!)).toContain("sha256");
    expect(fixture.files.get(input.envFile)).toContain("BRIDGE_STATE_PATH=C:\\Custom\\state.json");
    expect(fixture.files.get(input.envFile)?.match(/BRIDGE_STATE_PATH=/gu)).toHaveLength(1);
    for (const event of rollbackWrites) expect(fixture.events).toContainEqual(["protect", event[1]]);
  });

  test("stops exact writers and treats an already absent task as a retryable uninstall", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
    await installWindowsUserTask(input, fixture.io);
    fixture.setWriters(1);
    fixture.setTaskExists(false);
    await expect(uninstallWindowsUserTask(input.manifestPath, fixture.io)).resolves.toEqual({ removed: true });
    expect(fixture.events).toContainEqual(["stop-writers", input.entrypoint]);
    expect(fixture.events).not.toContainEqual(["run", "schtasks.exe", ["/Delete", "/TN", "\\Chat2Codex\\Chat2Codex", "/F"]]);
  });

  test("fails without deleting owned files when task deletion remains visible", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
    await installWindowsUserTask(input, fixture.io);
    fixture.keepTaskAfterDelete();
    await expect(uninstallWindowsUserTask(input.manifestPath, fixture.io)).rejects.toThrow(/task remained/i);
    expect(fixture.files.has(input.manifestPath)).toBe(true);
    expect(fixture.files.has(input.launcherPath)).toBe(true);
  });

  test("fails closed when writers remain, task deletion is uncertain, or an owned path traverses a reparse point", async () => {
    for (const configure of [
      (fixture: ReturnType<typeof ioFixture>) => fixture.failStopWriters(),
      (fixture: ReturnType<typeof ioFixture>) => fixture.failTaskQuery(),
      (fixture: ReturnType<typeof ioFixture>) => fixture.rejectOwnedPath(input.launcherPath),
    ]) {
      const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" });
      await installWindowsUserTask(input, fixture.io);
      configure(fixture);
      await expect(uninstallWindowsUserTask(input.manifestPath, fixture.io)).rejects.toThrow(/writer|task.*uncertain|canonical|reparse|owned path/i);
      expect(fixture.files.has(input.manifestPath)).toBe(true);
    }
  });
});

test("canonical Windows owned path refuses an existing junction component", async () => {
  if (process.platform !== "win32") return;
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-windows-owned-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "chat2codex-windows-outside-"));
  try {
    await mkdir(path.join(root, "home"), { recursive: true });
    await writeFile(path.join(outside, "sentinel.txt"), "outside");
    await symlink(outside, path.join(root, "home", "linked"), "junction");
    await expect(assertCanonicalWindowsOwnedPath(path.join(root, "home"), path.join(root, "home", "linked", "owned.txt"))).rejects.toThrow(/reparse|canonical/i);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

function ioFixture(initial: Record<string, string>, failRun: (args: string[]) => Error | undefined = () => undefined, initialKeyMode: "created" | "preserved" = "created") {
  const files = new Map(Object.entries(initial));
  const events: unknown[][] = [];
  const keyPaths = {
    "prompt-hook": `${home}\\.secrets\\desktop-gateway\\prompt-hook.key`,
    "stop-hook": `${home}\\.secrets\\desktop-gateway\\stop-hook.key`,
    "desktop-mcp": `${home}\\.secrets\\desktop-gateway\\desktop-mcp.key`,
  };
  let keyMode = initialKeyMode;
  let queryXml: string | undefined;
  const removeFailures = new Set<string>();
  const writeFailures = new Set<string>();
  const startFailures = new Set<string>();
  const rejectedOwnedPaths = new Set<string>();
  let writers = 0;
  let activeWriterEntrypoint: string | undefined;
  let stopWritersFails = false;
  let taskExists = files.has(input.manifestPath);
  let taskQueryFails = false;
  let keepDeletedTask = false;
  if (keyMode === "preserved") for (const file of Object.values(keyPaths)) files.set(file, "preexisting-key");
  const io: WindowsServiceIo = {
    currentUserSid: async () => "S-1-5-21-1-2-3-1001", now: () => new Date("2026-08-02T14:00:00.000Z"), packageVersion: async () => "0.8.0-desktop.2",
    readText: async (file) => { events.push(["read", file]); return files.get(file) ?? null; },
    writeTextAtomic: async (file, content) => { events.push(["write", file]); if (writeFailures.delete(file)) throw new Error("write failed"); files.set(file, content); },
    removeFile: async (file) => { events.push(["remove", file]); if (removeFailures.delete(file)) throw new Error("remove failed"); files.delete(file); },
    assertOwnedPath: async (file) => { events.push(["assert-owned", file]); if (rejectedOwnedPaths.has(file)) throw new Error("owned path traverses a reparse point"); },
    protectPrivateFile: async (file) => { events.push(["protect", file]); },
    stopWriters: async (entrypoint) => { events.push(["stop-writers", entrypoint]); if (stopWritersFails) throw new Error("writer stop failed"); const stopped = activeWriterEntrypoint === entrypoint ? writers : 0; if (stopped) { writers = 0; activeWriterEntrypoint = undefined; } return stopped; },
    countWriters: async (entrypoint) => { events.push(["count-writers", entrypoint]); return activeWriterEntrypoint === entrypoint ? writers : 0; },
    startAndVerifyTask: async (taskPath, entrypoint, statePath) => { events.push(["start-and-verify-task", taskPath, entrypoint, statePath]); if (!taskExists || writers !== 0 || !files.has(statePath)) throw new Error("writer health verification failed"); writers = 1; activeWriterEntrypoint = entrypoint; if (startFailures.delete(entrypoint)) throw new Error("replacement writer unhealthy"); },
    taskExists: async (taskPath) => { events.push(["task-exists", taskPath]); if (taskQueryFails) throw new Error("task state uncertain"); return taskExists; },
    ensureGatewayKeys: async () => {
      if (keyMode === "created") for (const file of Object.values(keyPaths)) files.set(file, "generated-key");
      return { created: keyMode === "created" ? Object.values(keyPaths) : [], preserved: keyMode === "preserved" ? Object.values(keyPaths) : [], paths: keyPaths };
    },
    runFile: async (command, args) => { events.push(["run", command, args]); const error = failRun(args); if (error) throw error; if (args[0] === "/Create") taskExists = true; if (args[0] === "/Delete" && !keepDeletedTask) taskExists = false; return args[0] === "/Query" ? queryXml ?? files.get(input.taskXmlPath) ?? "" : ""; },
  };
  return { io, files, events, keyPaths, setKeyMode(value: "created" | "preserved") { keyMode = value; }, setQueryXml(value: string) { queryXml = value; }, failRemoveOnce(file: string) { removeFailures.add(file); }, failWriteOnce(file: string) { writeFailures.add(file); }, failStartOnce(entrypoint: string) { startFailures.add(entrypoint); }, setWriters(value: number, entrypoint = input.entrypoint) { writers = value; activeWriterEntrypoint = value ? entrypoint : undefined; }, writerCount() { return writers; }, writerEntrypoint() { return activeWriterEntrypoint; }, failStopWriters() { stopWritersFails = true; }, setTaskExists(value: boolean) { taskExists = value; }, failTaskQuery() { taskQueryFails = true; }, keepTaskAfterDelete() { keepDeletedTask = true; }, rejectOwnedPath(file: string) { rejectedOwnedPaths.add(file); } };
}

function priorManifest() {
  return { schemaVersion: 1 as const, packageVersion: "0.8.0-old.1", taskName: "Chat2Codex", userSid: "S-1-5-21-1-2-3-1001", launcherPath: input.launcherPath, nodeBin: input.nodeBin, entrypoint: input.entrypoint, statePath: input.statePath, envFile: input.envFile, keyFiles: gatewayKeyFiles, ownedKeyFiles: gatewayKeyFiles, ownedFiles: [input.launcherPath, input.taskXmlPath, input.manifestPath], hashes: { old: "a".repeat(64) }, installedAt: "2026-08-01T00:00:00.000Z" };
}

function priorManifestFor(launcher: string, taskXml: string) {
  const manifest = priorManifest();
  manifest.hashes = { "launcher.ps1": sha256(launcher), "task.xml": sha256(taskXml) };
  return manifest;
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
