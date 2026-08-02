import { describe, expect, test } from "bun:test";
import path from "node:path";

import { buildLocalOpenSpecInvocation } from "../scripts/run-local-openspec.mjs";

describe("local OpenSpec wrapper", () => {
  test("builds one project-local validation invocation with tracking disabled", () => {
    const repositoryRoot = path.resolve("fixture-repository");
    const invocation = buildLocalOpenSpecInvocation({
      repositoryRoot,
      nodeVersion: "24.14.0",
      args: ["validate", "--all", "--strict", "--no-color"],
      environment: { PATH: "C:\\bin" },
    });
    expect(invocation.executable).toBe(process.execPath);
    expect(invocation.args[0]).toBe(path.join(repositoryRoot, "node_modules", "@fission-ai", "openspec", "bin", "openspec.js"));
    expect(invocation.args.slice(1)).toEqual(["validate", "--all", "--strict", "--no-color"]);
    expect(invocation.options).toMatchObject({ cwd: repositoryRoot, windowsHide: true, shell: false, stdio: "inherit" });
    expect(invocation.options.env).toMatchObject({
      PATH: "C:\\bin", OPENSPEC_TELEMETRY: "0", OPENSPEC_NO_UPDATE_CHECK: "1",
      DO_NOT_TRACK: "1", NO_COLOR: "1", CI: "1",
    });
  });

  test("rejects old Node, mutating commands, and unknown commands", () => {
    expect(() => buildLocalOpenSpecInvocation({ repositoryRoot: "C:\\repo", nodeVersion: "20.18.9", args: ["validate"], environment: {} })).toThrow(/20\.19\.0/);
    for (const command of ["init", "update", "archive", "store", "config", "schema", "completion", "feedback", "new", "list", "show", "status", "doctor", "unknown"]) {
      expect(() => buildLocalOpenSpecInvocation({ repositoryRoot: "C:\\repo", nodeVersion: "24.14.0", args: [command], environment: {} })).toThrow(/not allowed/i);
    }
  });
});
