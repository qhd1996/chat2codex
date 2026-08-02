import { expect, test } from "bun:test";
import fc from "fast-check";

import { removeManagedEnvBlock, replaceManagedEnvBlock } from "../../src/setup/windows-lifecycle.js";

const seed = 2026080202;

test("property: repeating the managed install block is byte-idempotent", () => {
  fc.assert(fc.property(
    fc.array(fc.tuple(
      fc.stringMatching(/^[A-Z][A-Z0-9_]{0,20}$/u).filter((key) => !key.startsWith("CHAT2CODEX_")),
      fc.stringMatching(/^[A-Za-z0-9._-]{0,30}$/u),
    ), { minLength: 0, maxLength: 12 }),
    (entries) => {
      const unique = new Map(entries);
      const source = [...unique].map(([key, value]) => key + "=" + value).join("\r\n") + (unique.size ? "\r\n" : "");
      const managed = { CHAT2CODEX_DESKTOP_GATEWAY_ENABLED: "true", CHAT2CODEX_HOME: "C:/Users/<you>/.chat2codex" };
      const once = replaceManagedEnvBlock(source, managed);
      const twice = replaceManagedEnvBlock(once, managed);
      expect(twice).toBe(once);
      expect(removeManagedEnvBlock(twice)).toBe(source);
    },
  ), { seed, numRuns: 100, endOnFailure: true });
});

test("property: malformed or repeated managed markers fail closed", () => {
  fc.assert(fc.property(fc.constantFrom(
    "# BEGIN CHAT2CODEX WINDOWS MANAGED\r\n",
    "# END CHAT2CODEX WINDOWS MANAGED\r\n",
    "# BEGIN CHAT2CODEX WINDOWS MANAGED\r\nA=b\r\n# BEGIN CHAT2CODEX WINDOWS MANAGED\r\n",
  ), (source) => {
    expect(() => replaceManagedEnvBlock(source, { CHAT2CODEX_HOME: "C:/Users/<you>/.chat2codex" })).toThrow(/managed block/i);
  }), { seed, numRuns: 100, endOnFailure: true });
});
