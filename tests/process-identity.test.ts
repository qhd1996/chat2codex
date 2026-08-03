import { expect, test } from "bun:test";

import { descendantIdentities, processIdExists, sameProcessIdentity } from "../scripts/process-identity.mjs";

test("does not treat a reused pid as the original process identity", () => {
  expect(sameProcessIdentity(
    { pid: 15628, createdAt: "2026-08-02T05:49:19.929Z" },
    { pid: 15628, createdAt: "2026-08-02T02:53:11.000Z" },
  )).toBe(false);
});

test("tracks only descendants created after the root identity", () => {
  const root = { pid: 10, parentPid: 1, createdAt: "2026-08-02T05:00:00.000Z" };
  const rows = [
    root,
    { pid: 20, parentPid: 10, createdAt: "2026-08-02T05:00:01.000Z" },
    { pid: 30, parentPid: 20, createdAt: "2026-08-02T05:00:02.000Z" },
    { pid: 40, parentPid: 10, createdAt: "2026-08-02T04:59:59.000Z" },
  ];
  expect(descendantIdentities(rows, root).map((row) => row.pid)).toEqual([20, 30]);
});

test("checks an exited pid without starting an external process", () => {
  expect(processIdExists(process.pid)).toBe(true);
  expect(processIdExists(0x7fffffff)).toBe(false);
});
