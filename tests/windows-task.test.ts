import { describe, expect, test } from "bun:test";

import { renderWindowsLauncher, renderWindowsTaskXml } from "../src/setup/windows-task.js";

const taskInput = {
  taskName: "Chat2Codex",
  userSid: "S-1-5-21-1000-1000-1000-1001",
  launcherPath: "C:\\Users\\Example User\\.chat2codex\\.service\\windows\\launcher.ps1",
};

describe("Windows user task rendering", () => {
  test("renders a least-privilege current-user logon task with restart and no overlap", () => {
    const xml = renderWindowsTaskXml(taskInput);
    expect(xml).toStartWith("<Task ");
    expect(xml).not.toContain("<?xml");
    expect(xml).toContain("<UserId>S-1-5-21-1000-1000-1000-1001</UserId>");
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<RestartOnFailure>");
    expect(xml).toContain("<Interval>PT1M</Interval>");
    expect(xml).toContain("<Count>3</Count>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<Command>powershell.exe</Command>");
    expect(xml).toContain("&apos;C:\\Users\\Example User\\.chat2codex\\.service\\windows\\launcher.ps1&apos;");
    expect(xml).not.toContain("HighestAvailable");
  });

  test("escapes XML and rejects relative, malformed, or unsafe inputs", () => {
    expect(renderWindowsTaskXml({ ...taskInput, taskName: "Chat2Codex & Personal" })).toContain("Chat2Codex &amp; Personal");
    expect(() => renderWindowsTaskXml({ ...taskInput, launcherPath: "relative.ps1" })).toThrow(/absolute/i);
    expect(() => renderWindowsTaskXml({ ...taskInput, taskName: "bad\nname" })).toThrow(/task name/i);
    expect(() => renderWindowsTaskXml({ ...taskInput, userSid: "Example User" })).toThrow(/SID/i);
  });
});

describe("Windows launcher rendering", () => {
  test("quotes arbitrary absolute paths without interpolating environment values", () => {
    const source = renderWindowsLauncher({
      nodeBin: "C:\\Program Files\\nodejs\\node.exe",
      entrypoint: "C:\\Users\\O'Brien\\AppData\\Roaming\\npm\\node_modules\\chat2codex\\dist\\index.js",
      envFile: "C:\\Users\\O'Brien\\.chat2codex\\.env",
      logFile: "C:\\Users\\O'Brien\\.chat2codex\\.data\\logs\\service.log",
      pathEnv: "C:\\Program Files\\nodejs;C:\\Windows\\System32",
      workingDirectory: "C:\\Users\\O'Brien\\.chat2codex",
    });
    expect(source).toContain("$env:CHAT2CODEX_ENV = 'C:\\Users\\O''Brien\\.chat2codex\\.env'");
    expect(source).toContain("$env:CHAT2CODEX_SERVICE_RESTART_ENABLED = 'true'");
    expect(source).toContain("Set-Location -LiteralPath 'C:\\Users\\O''Brien\\.chat2codex'");
    expect(source).toContain("& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\Users\\O''Brien\\AppData");
    expect(source).toContain("\\dist\\index.js' start *>>");
    expect(source).toContain("*>> 'C:\\Users\\O''Brien\\.chat2codex\\.data\\logs\\service.log'");
    expect(source).not.toContain("Invoke-Expression");
  });

  test("rejects relative paths and control characters", () => {
    const valid = { nodeBin: "C:\\node\\node.exe", entrypoint: "C:\\pkg\\dist\\index.js", envFile: "C:\\home\\.env", logFile: "C:\\home\\service.log", pathEnv: "C:\\node", workingDirectory: "C:\\home" };
    expect(() => renderWindowsLauncher({ ...valid, entrypoint: "dist/index.js" })).toThrow(/absolute/i);
    expect(() => renderWindowsLauncher({ ...valid, pathEnv: "C:\\node\nC:\\evil" })).toThrow(/control/i);
  });
});
