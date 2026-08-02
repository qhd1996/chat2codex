import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const root = path.resolve(import.meta.dir, "..");

describe("Windows quality workflow", () => {
  test("pins the platform and runs complete auditable gates", async () => {
    const source = await readFile(path.join(root, ".github", "workflows", "windows-ci.yml"), "utf8");
    for (const required of [
      "windows-latest", "actions/checkout@v7", "actions/setup-node@v7", 'node-version: "24"',
      "fetch-depth: 0",
      "oven-sh/setup-bun@v2", "bun-version: 1.3.9", "bun install --frozen-lockfile",
      "bun run quality:check", "scripts/run-test-shard.mjs", "bun run check",
      "scripts/make-router-shards.mjs", "tests/message-router.test.ts", "quality:windows",
      "actions/upload-artifact@v4", "if: always()", "retention-days:",
    ]) expect(source).toContain(required);
    expect((source.match(/run-test-shard\.mjs/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/timeout-minutes:\s*[1-9][0-9]?/u);
    expect(source).toMatch(/permissions:\s*[\r\n]+\s+contents:\s+read/u);
  });

  test("cannot operate production, user Codex, Desktop, or Weixin", async () => {
    const source = await readFile(path.join(root, ".github", "workflows", "windows-ci.yml"), "utf8");
    expect(source).not.toMatch(/F:[\\/]Chat2Codex|\.codex|Set-Acl|icacls|schtasks|Start-ScheduledTask|Stop-Process|taskkill.*Chat2Codex|Computer Use|send.*Weixin|微信.*发送|hook.*install/iu);
    expect(source).not.toMatch(/contents:\s+write|id-token:\s+write|packages:\s+write/iu);
  });
});
