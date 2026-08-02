import { describe, expect, test } from "bun:test";

import { installWindowsUserTask, uninstallWindowsUserTask, type WindowsServiceIo } from "../src/setup/windows-service.js";

const home = "C:\\Users\\Example\\.chat2codex";
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
    expect(fixture.files.get(input.envFile)).toContain("USER_SETTING=yes");
    expect(fixture.files.get(input.envFile)).toContain("CHAT2CODEX_DESKTOP_GATEWAY_ENABLED=true");
    expect(fixture.files.get(input.envFile)).toContain(`CHAT2CODEX_HOME=${JSON.stringify(home)}`);
    expect(fixture.files.get(input.envFile)).toContain(`BRIDGE_STATE_PATH=${JSON.stringify(input.statePath)}`);
    expect(fixture.files.get(input.envFile)).toContain(`ATTACHMENT_DOWNLOAD_DIR=${JSON.stringify(`${home}\\.data\\attachments`)}`);
    expect(JSON.stringify(result)).not.toContain("secret-material");
  });

  test("restores prior owned files and unregisters after task verification failure", async () => {
    const prior = { [input.envFile]: "USER_SETTING=yes\r\n", [input.launcherPath]: "old launcher", [input.manifestPath]: "old manifest" };
    const fixture = ioFixture(prior, (args) => args[0] === "/Query" ? new Error("query failed") : undefined);
    await expect(installWindowsUserTask(input, fixture.io)).rejects.toThrow(/query failed/i);
    expect(fixture.events).toContainEqual(["run", "schtasks.exe", ["/Delete", "/TN", "\\Chat2Codex\\Chat2Codex", "/F"]]);
    for (const [file, content] of Object.entries(prior)) expect(fixture.files.get(file)).toBe(content);
    expect(fixture.files.has(input.taskXmlPath)).toBe(false);
  });

  test("uninstall removes exact owned files and managed env while preserving user data", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n# BEGIN CHAT2CODEX WINDOWS MANAGED\r\nA=b\r\n# END CHAT2CODEX WINDOWS MANAGED\r\n" });
    await installWindowsUserTask(input, fixture.io);
    fixture.files.set(`${home}\\.data\\state.json`, "durable");
    await uninstallWindowsUserTask(input.manifestPath, fixture.io);
    expect(fixture.events).toContainEqual(["run", "schtasks.exe", ["/Delete", "/TN", "\\Chat2Codex\\Chat2Codex", "/F"]]);
    expect(fixture.files.get(input.envFile)).toBe("USER_SETTING=yes\r\n");
    expect(fixture.files.get(`${home}\\.data\\state.json`)).toBe("durable");
    expect(fixture.files.has(input.launcherPath)).toBe(false);
    expect(fixture.files.has(input.manifestPath)).toBe(false);
  });

  test("preserves preexisting non-owned keys across install and uninstall", async () => {
    const fixture = ioFixture({ [input.envFile]: "USER_SETTING=yes\r\n" }, () => undefined, "preserved");
    await installWindowsUserTask(input, fixture.io);
    await uninstallWindowsUserTask(input.manifestPath, fixture.io);
    for (const file of Object.values(fixture.keyPaths)) expect(fixture.files.get(file)).toBe("preexisting-key");
  });

  test("writes a hash-recorded rollback snapshot before an upgrade", async () => {
    const priorManifest = { schemaVersion: 1, packageVersion: "0.8.0-old.1", taskName: "Chat2Codex", userSid: "S-1-5-21-1-2-3-1001", launcherPath: input.launcherPath, nodeBin: input.nodeBin, entrypoint: input.entrypoint, statePath: input.statePath, envFile: input.envFile, keyFiles: [], ownedKeyFiles: [], ownedFiles: [input.launcherPath, input.taskXmlPath, input.manifestPath], hashes: { old: "a".repeat(64) }, installedAt: "2026-08-01T00:00:00.000Z" };
    const fixture = ioFixture({ [input.envFile]: "CUSTOM_STATE=yes\r\nBRIDGE_STATE_PATH=C:\\Custom\\state.json\r\n", [input.manifestPath]: JSON.stringify(priorManifest), [input.statePath]: "{\"schemaVersion\":6}" });
    await installWindowsUserTask(input, fixture.io);
    const rollbackWrites = fixture.events.filter((event) => event[0] === "write" && String(event[1]).includes("\\rollback\\"));
    expect(rollbackWrites.length).toBeGreaterThanOrEqual(3);
    const recordPath = rollbackWrites.map((event) => String(event[1])).find((file) => file.endsWith("backup.json"));
    expect(recordPath).toBeDefined();
    expect(fixture.files.get(recordPath!)).toContain("sha256");
    expect(fixture.files.get(input.envFile)).toContain("BRIDGE_STATE_PATH=C:\\Custom\\state.json");
    expect(fixture.files.get(input.envFile)?.match(/BRIDGE_STATE_PATH=/gu)).toHaveLength(1);
  });
});

function ioFixture(initial: Record<string, string>, failRun: (args: string[]) => Error | undefined = () => undefined, keyMode: "created" | "preserved" = "created") {
  const files = new Map(Object.entries(initial));
  const events: unknown[][] = [];
  const keyPaths = {
    "prompt-hook": `${home}\\.secrets\\desktop-gateway\\prompt-hook.key`,
    "stop-hook": `${home}\\.secrets\\desktop-gateway\\stop-hook.key`,
    "desktop-mcp": `${home}\\.secrets\\desktop-gateway\\desktop-mcp.key`,
  };
  if (keyMode === "preserved") for (const file of Object.values(keyPaths)) files.set(file, "preexisting-key");
  const io: WindowsServiceIo = {
    currentUserSid: async () => "S-1-5-21-1-2-3-1001", now: () => new Date("2026-08-02T14:00:00.000Z"), packageVersion: async () => "0.8.0-desktop.2",
    readText: async (file) => files.get(file) ?? null,
    writeTextAtomic: async (file, content) => { events.push(["write", file]); files.set(file, content); },
    removeFile: async (file) => { events.push(["remove", file]); files.delete(file); },
    ensureGatewayKeys: async () => ({ created: keyMode === "created" ? Object.values(keyPaths) : [], preserved: keyMode === "preserved" ? Object.values(keyPaths) : [], paths: keyPaths }),
    runFile: async (command, args) => { events.push(["run", command, args]); const error = failRun(args); if (error) throw error; return args[0] === "/Query" ? "<Task/>" : ""; },
  };
  return { io, files, events, keyPaths };
}
