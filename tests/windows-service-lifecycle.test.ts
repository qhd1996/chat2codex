import { describe, expect, test } from "bun:test";

import { installWindowsUserTask, uninstallWindowsUserTask, type WindowsServiceIo } from "../src/setup/windows-service.js";

const home = "C:\\Users\\Example\\.chat2codex";
const input = {
  home, envFile: `${home}\\.env`, launcherPath: `${home}\\.service\\windows\\launcher.ps1`,
  taskXmlPath: `${home}\\.service\\windows\\task.xml`, manifestPath: `${home}\\.service\\windows\\installation.json`,
  nodeBin: "C:\\Program Files\\nodejs\\node.exe", entrypoint: "C:\\Users\\Example\\AppData\\Roaming\\npm\\node_modules\\chat2codex\\dist\\index.js",
  logFile: `${home}\\.data\\logs\\service.log`, pathEnv: "C:\\Program Files\\nodejs;C:\\Windows\\System32", taskName: "Chat2Codex",
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
});

function ioFixture(initial: Record<string, string>, failRun: (args: string[]) => Error | undefined = () => undefined) {
  const files = new Map(Object.entries(initial));
  const events: unknown[][] = [];
  const keyPaths = {
    "prompt-hook": `${home}\\.secrets\\desktop-gateway\\prompt-hook.key`,
    "stop-hook": `${home}\\.secrets\\desktop-gateway\\stop-hook.key`,
    "desktop-mcp": `${home}\\.secrets\\desktop-gateway\\desktop-mcp.key`,
  };
  const io: WindowsServiceIo = {
    currentUserSid: async () => "S-1-5-21-1-2-3-1001", now: () => new Date("2026-08-02T14:00:00.000Z"), packageVersion: async () => "0.8.0-desktop.2",
    readText: async (file) => files.get(file) ?? null,
    writeTextAtomic: async (file, content) => { events.push(["write", file]); files.set(file, content); },
    removeFile: async (file) => { events.push(["remove", file]); files.delete(file); },
    ensureGatewayKeys: async () => ({ created: Object.values(keyPaths), preserved: [], paths: keyPaths }),
    runFile: async (command, args) => { events.push(["run", command, args]); const error = failRun(args); if (error) throw error; return args[0] === "/Query" ? "<Task/>" : ""; },
  };
  return { io, files, events };
}
