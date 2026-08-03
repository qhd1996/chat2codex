import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const root = path.resolve(import.meta.dir, "..");

describe("Windows quality workflow", () => {
  test("pins every third-party action to an immutable commit SHA", async () => {
    for (const file of ["windows-ci.yml", "windows-quality.yml"]) {
      const source = await readFile(path.join(root, ".github", "workflows", file), "utf8");
      const uses = [...source.matchAll(/^\s*uses:\s*([^#\s]+)(?:\s*#\s*(.+))?$/gmu)];
      expect(uses.length).toBeGreaterThan(0);
      for (const match of uses) {
        expect(match[1]).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/u);
        expect(match[2]).toMatch(/^v[0-9]+(?:\.[0-9]+){0,2}$/u);
      }
    }
  });
  test("pins the platform and runs complete auditable gates", async () => {
    const source = await readFile(path.join(root, ".github", "workflows", "windows-ci.yml"), "utf8");
    for (const required of [
      "windows-latest", "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7", "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7", 'node-version: "24"',
      "fetch-depth: 0",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2", "bun-version: 1.3.9", "bun install --frozen-lockfile",
      "bun run quality:check", "scripts/run-test-shard.mjs", "bun run check:stable",
      "scripts/make-router-shards.mjs", "tests/message-router.test.ts", "quality:windows",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4", "if: always()", "retention-days:",
    ]) expect(source).toContain(required);
    expect((source.match(/run-test-shard\.mjs/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/timeout-minutes:\s*[1-9][0-9]?/u);
    expect(source).toMatch(/permissions:\s*[\r\n]+\s+contents:\s+read/u);
  });

  test("defines a deterministic complete repository gate without replacing the fast diagnostic", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    expect(packageJson.scripts.test).toBe("bun test");
    expect(packageJson.scripts.check).toContain("bun test");
    expect(packageJson.scripts["test:stable"]).toBe("bun test --max-concurrency=1");
    expect(packageJson.scripts["check:stable"]).toBe("bun run typecheck && bun run typecheck:contracts && bun run test:stable && bun run build");
  });

  test("anchors every generated Router shard to one exact test-name suffix", async () => {
    const source = await readFile(path.join(root, "scripts", "make-router-shards.mjs"), "utf8");
    expect(source).toContain('pattern: `(?:${items.map(escape).join("|")})$`');
    expect(source).toContain("candidate.endsWith(name)");
  });

  test("cannot operate production, user Codex, Desktop, or Weixin", async () => {
    const source = await readFile(path.join(root, ".github", "workflows", "windows-ci.yml"), "utf8");
    expect(source).not.toMatch(/F:[\\/]Chat2Codex|\.codex|Set-Acl|icacls|schtasks|Start-ScheduledTask|Stop-Process|taskkill.*Chat2Codex|Computer Use|send.*Weixin|微信.*发送|hook.*install/iu);
    expect(source).not.toMatch(/contents:\s+write|id-token:\s+write|packages:\s+write/iu);
  });
});
