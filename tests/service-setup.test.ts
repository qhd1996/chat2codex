import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  createServiceOptions,
  defaultServiceTarget,
  renderLaunchdPlist,
  renderSystemdUnit,
  parseWindowsWhoamiSid,
  parseWindowsTaskNames,
  systemdUnitPath,
} from "../src/setup/service.js";

describe("service setup", () => {
  const posixServiceTest = process.platform === "win32" ? test.skip : test;

  posixServiceTest("renders a launchd plist for the built Node entrypoint", () => {
    const options = createServiceOptions({
      target: "launchd",
      projectDir: path.posix.join("/tmp", "chat&codex"),
      envFile: path.posix.join("/tmp", "chat&codex", ".env"),
      nodeBin: "/opt/node/bin/node",
      pathEnv: "/opt/node/bin:/usr/bin",
      launchdLabel: "com.example.chat2codex",
      stderrPath: path.posix.join("/tmp", "chat&codex", "runtime.log"),
    });

    const plist = renderLaunchdPlist(options);

    expect(plist).toContain("<string>com.example.chat2codex</string>");
    expect(plist).toContain("<string>/opt/node/bin/node</string>");
    expect(plist).toContain("<string>/tmp/chat&amp;codex/dist/index.js</string>");
    expect(plist).toContain("<key>WorkingDirectory</key>");
    expect(plist).toContain("<string>/tmp/chat&amp;codex</string>");
    expect(plist).toContain("<key>CHAT2CODEX_ENV</key>");
    expect(plist).toContain("<string>/tmp/chat&amp;codex/.env</string>");
    expect(plist).toContain("<key>CHAT2CODEX_LOG_FILE</key>");
    expect(plist).toContain("<key>CHAT2CODEX_SERVICE_RESTART_ENABLED</key>");
    expect(plist).toContain("<string>/tmp/chat&amp;codex/runtime.log</string>");
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).toContain("<string>/opt/node/bin:/usr/bin</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist.match(/<string>\/dev\/null<\/string>/gu)).toHaveLength(2);
    expect(options.stdoutPath).toEndWith("/.chat2codex/.data/logs/chat2codex.out.log");
    expect(options.stderrPath).toBe("/tmp/chat&codex/runtime.log");
  });

  posixServiceTest("renders a systemd user unit with quoted paths and env file", () => {
    const options = createServiceOptions({
      target: "systemd",
      projectDir: path.posix.join("/tmp", "chat 2 codex"),
      envFile: path.posix.join("/tmp", "chat 2 codex", ".env"),
      nodeBin: "/usr/local/bin/node",
      pathEnv: "/usr/local/bin:/usr/bin",
      systemdServiceName: "chat2codex-test.service",
    });

    const unit = renderSystemdUnit(options);

    expect(unit).toContain('WorkingDirectory="/tmp/chat 2 codex"');
    expect(unit).toContain('Environment="NODE_ENV=production"');
    expect(unit).toContain('Environment="CHAT2CODEX_SERVICE_RESTART_ENABLED=true"');
    expect(unit).toContain('Environment="PATH=/usr/local/bin:/usr/bin"');
    expect(unit).toContain('EnvironmentFile=-"/tmp/chat 2 codex/.env"');
    expect(unit).toContain('ExecStart="/usr/local/bin/node" "/tmp/chat 2 codex/dist/index.js"');
    expect(unit).toContain("Restart=always");
    expect(unit).not.toContain("CHAT2CODEX_LOG_FILE");
    expect(systemdUnitPath("chat2codex-test.service")).toEndWith(
      "/.config/systemd/user/chat2codex-test.service",
    );
  });

  test("chooses launchd only on macOS by default", () => {
    expect(defaultServiceTarget("darwin")).toBe("launchd");
    expect(defaultServiceTarget("linux")).toBe("systemd");
    expect(defaultServiceTarget("win32")).toBe("windows-task");
  });

  test("uses an absolute Node executable for the Windows task by default", () => {
    const options = createServiceOptions({ target: "windows-task" });
    expect(path.win32.isAbsolute(options.nodeBin) || path.isAbsolute(options.nodeBin)).toBe(true);
  });

  test("parses exactly one SID from locale-independent whoami output", () => {
    expect(parseWindowsWhoamiSid(`"DESKTOP\\User","S-1-5-21-1-2-3-1001"\r\n`)).toBe("S-1-5-21-1-2-3-1001");
    expect(() => parseWindowsWhoamiSid("")).toThrow(/SID/i);
    expect(() => parseWindowsWhoamiSid("S-1-5-18 S-1-5-32-544")).toThrow(/SID/i);
    expect(() => parseWindowsWhoamiSid("S-1-bad")).toThrow(/SID/i);
  });

  test("parses exact task names from successful schtasks CSV and fails malformed or ambiguous output closed", () => {
    expect(parseWindowsTaskNames(`"\\Chat2Codex\\Chat2Codex","N/A","Ready"\r\n"\\Microsoft\\Windows\\Task","N/A","Ready"\r\n`)).toEqual(["\\Chat2Codex\\Chat2Codex", "\\Microsoft\\Windows\\Task"]);
    expect(parseWindowsTaskNames("")).toEqual([]);
    expect(() => parseWindowsTaskNames("ERROR: access denied\r\n")).toThrow(/enumeration|malformed/i);
    expect(parseWindowsTaskNames(`"\\Chat2Codex\\Chat2Codex"\r\n"\\chat2codex\\chat2codex"\r\n`)).toEqual(["\\chat2codex\\chat2codex"]);
  });
});
