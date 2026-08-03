import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  extractReleaseNotes,
  findPreviousTag,
  renderReleaseNotes,
} from "../scripts/render-release-notes.mjs";

const changelog = `# Changelog

## Unreleased

## 0.4.0 - 2026-07-17

### Added

- Added feature.

### Fixed

- Fixed bug.

## 0.3.0 - 2026-07-06

### Added

- Previous feature.
`;

describe("release notes rendering", () => {
  test("uses a distinct Phase 3 pre-install package identity", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve(import.meta.dir, "..", "package.json"), "utf8"));
    expect(packageJson.version).toBe("0.8.0-novice.8");
    const changelog = await readFile(path.resolve(import.meta.dir, "..", "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("Scheduled Task");
    expect(changelog).toContain("owner-only ACL");
    expect(changelog).toContain("real `~/.codex`");
  });
  test("extracts one version and promotes changelog headings", () => {
    expect(extractReleaseNotes(changelog, "v0.4.0")).toBe(
      "## Added\n\n- Added feature.\n\n## Fixed\n\n- Fixed bug.",
    );
  });

  test("appends the previous-tag comparison link", () => {
    expect(
      renderReleaseNotes({
        changelog,
        currentTag: "v0.4.0",
        previousTag: "v0.3.0",
        repository: "hzhaoy/chat2codex",
      }),
    ).toEndWith(
      "**Full Changelog**: https://github.com/hzhaoy/chat2codex/compare/v0.3.0...v0.4.0",
    );
  });

  test("fails when the version section is missing or empty", () => {
    expect(() => extractReleaseNotes(changelog, "v9.9.9")).toThrow(
      "CHANGELOG.md has no section for 9.9.9",
    );
    expect(() =>
      extractReleaseNotes("## 1.0.0\n\n## 0.9.0\n\n- Previous", "v1.0.0"),
    ).toThrow("CHANGELOG.md section for 1.0.0 is empty");
  });

  test("selects the next older version-sorted tag", () => {
    expect(
      findPreviousTag(["v0.4.0", "v0.3.0", "v0.2.0"], "v0.4.0"),
    ).toBe("v0.3.0");
  });

  test("documents the bounded review-only UsageAdvisor contract in both READMEs and architecture", async () => {
    const root = path.resolve(import.meta.dir, "..");
    const [english, chinese, architecture] = await Promise.all([
      readFile(path.join(root, "README.md"), "utf8"),
      readFile(path.join(root, "README.zh-CN.md"), "utf8"),
      readFile(path.join(root, "docs/architecture.md"), "utf8"),
    ]);
    for (const source of [english, chinese, architecture]) {
      expect(source).toContain("/advisor approve");
      expect(source).toContain("approve_for_planning");
      expect(source).toContain("task_target_clarification");
      expect(source).toContain("delivery_retry");
      expect(source).toContain("proposal threshold: 3");
      expect(source).toContain("aggregate cap: 6");
      expect(source).toContain("proposal cap: 6");
      expect(source).toContain("recent timestamp cap: 8");
      expect(source).toContain("rollback");
    }
    expect(english).toContain("never applies, executes, or deploys a change");
    expect(chinese).toContain("不会应用、执行或部署变更");
    expect(architecture).toContain("best-effort");
    expect(architecture).toContain("schema v5");
  });

  test("documents the inert Phase 3 Gateway contract and seven-row acceptance boundary", async () => {
    const root = path.resolve(import.meta.dir, "..");
    const [english, chinese, architecture, environment, installation, rollback] = await Promise.all([
      readFile(path.join(root, "README.md"), "utf8"),
      readFile(path.join(root, "README.zh-CN.md"), "utf8"),
      readFile(path.join(root, "docs/architecture.md"), "utf8"),
      readFile(path.join(root, ".env.example"), "utf8"),
      readFile(path.join(root, "docs/phase3/installation-runbook.md"), "utf8"),
      readFile(path.join(root, "docs/phase3/rollback-runbook.md"), "utf8"),
    ]);

    for (const source of [english, chinese, architecture]) {
      expect(source).toContain("127.0.0.1");
      expect(source).toContain("UserPromptSubmit");
      expect(source).toContain("thread/read");
      expect(source).toContain("schema v6");
      expect(source.toLowerCase()).toContain("unbound");
      expect(source).toContain("plugin/list");
    }

    expect(environment).toContain("CHAT2CODEX_DESKTOP_GATEWAY_ENABLED=false");
    expect(environment).toContain("127.0.0.1");
    expect(environment).toContain("CHAT2CODEX_DESKTOP_HEARTBEAT_MS=10000");
    expect(environment).not.toContain("CHAT2CODEX_DESKTOP_GATEWAY_HEARTBEAT_MS");
    expect(environment).not.toMatch(/^[^#\r\n]*CHAT2CODEX_DESKTOP_.*(?:TOKEN|SECRET|KEY)=\S+/mu);

    expect(installation).toMatch(/^# Phase 3 installation runbook\r?\n\r?\n> STOP:/u);
    for (const approval of ["~/.codex", "Hook trust", "Desktop restart", "production write", "Computer Use", "real Weixin send"]) {
      expect(installation).toContain(approval);
    }
    expect(installation).toContain("Hook SHA-256 manifest");
    expect(installation).toContain("temporary Codex Home");
    expect(installation).toContain("verify-phase3-temp-codex-home.mjs");
    expect(installation.match(/^\| [1-7]\. /gmu)).toHaveLength(7);

    expect(rollback).toContain("immediate bridge-only mode");
    expect(rollback.toLowerCase()).toContain("full schema v6 to v5 downgrade");
    expect(rollback).toContain("STOP-ROLLBACK");
    expect(rollback).toContain("undelivered outbox");
  });
});
