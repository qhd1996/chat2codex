import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const runner = path.join(repositoryRoot, "scripts", "run-novice-matrix.mjs");
const publisher = path.join(repositoryRoot, "scripts", "publish-novice-matrix-evidence.mjs");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("novice matrix bounded diagnostics", () => {
  test("stops before the loop when the initial bounded report cannot be written", async () => {
    const fixture = await createFixture("marker");
    const reportDirectory = path.join(fixture.root, "evidence");
    await mkdir(reportDirectory, { recursive: true });

    const result = runMatrix(fixture.root, reportDirectory);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("initialization/report/report_unavailable");
    expect(await readFile(path.join(fixture.root, "shard-ran"), "utf8").catch(() => null)).toBeNull();
  });

  test("writes a bounded report when tracked files are dirty before the loop", async () => {
    const fixture = await createFixture("missing");
    await writeFile(path.join(fixture.root, "tracked.txt"), "dirty\n");

    const result = runMatrix(fixture.root, fixture.report);
    const report = await readJson(fixture.report);

    expect(result.exitCode).not.toBe(0);
    expect(report?.failure).toEqual({ stage: "preflight/git_clean", code: "tracked_dirty", repetition: null });
    expectBounded(report, fixture.root);
  });

  test("retains bounded prior failure history when a preflight failure replaces the report", async () => {
    const fixture = await createFixture("missing");
    await mkdir(path.dirname(fixture.report), { recursive: true });
    await writeFile(fixture.report, JSON.stringify({ failureHistory: [
      { repetition: 2, code: "matrix_repetition_failed", fixedByCommit: "b".repeat(40) },
      { repetition: 99, code: "invalid", fixedByCommit: null },
    ] }));
    await writeFile(path.join(fixture.root, "tracked.txt"), "dirty\n");

    const result = runMatrix(fixture.root, fixture.report);
    const report = await readJson(fixture.report);

    expect(result.exitCode).not.toBe(0);
    expect(report?.failureHistory).toEqual([{ repetition: 2, code: "matrix_repetition_failed", fixedByCommit: "b".repeat(40) }]);
    expectBounded(report, fixture.root);
  });

  test("writes a bounded report when the shard report is missing", async () => {
    const fixture = await createFixture("missing");

    const result = runMatrix(fixture.root, fixture.report);
    const report = await readJson(fixture.report);

    expect(result.exitCode).not.toBe(0);
    expect(report?.failure).toEqual({ stage: "repetition/shard_report", code: "missing", repetition: 1 });
    expectBounded(report, fixture.root);
  });

  test("writes a bounded report when the shard report is invalid JSON", async () => {
    const fixture = await createFixture("invalid");

    const result = runMatrix(fixture.root, fixture.report);
    const report = await readJson(fixture.report);

    expect(result.exitCode).not.toBe(0);
    expect(report?.failure).toEqual({ stage: "repetition/shard_report", code: "invalid", repetition: 1 });
    expectBounded(report, fixture.root);
  });

  test("publishes only bounded matrix evidence while retaining a blocking verdict", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "c2c-matrix-publish-"));
    temporaryRoots.push(temporary);
    const report = path.join(temporary, "report.json");
    const summary = path.join(temporary, "summary.md");
    await writeFile(report, JSON.stringify({
      schemaVersion: 1, verdict: "fail", repositoryCommit: "a".repeat(40), repetitionsCompleted: 0,
      failure: { stage: "preflight/git_clean", code: "tracked_dirty", repetition: null },
      cleanup: { attempted: false, succeeded: false },
    }));

    const result = Bun.spawnSync([process.execPath, publisher, report], {
      cwd: repositoryRoot, env: { ...process.env, GITHUB_STEP_SUMMARY: summary }, stdout: "pipe", stderr: "pipe",
    });
    const output = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(output).toContain("::error title=Novice matrix evidence::");
    expect(output).toContain('\"stage\":\"preflight/git_clean\"');
    expect(output).not.toContain(temporary);
    expect(await readFile(summary, "utf8")).toContain("preflight/git_clean");
  });

  test("fails closed when a claimed pass is not a complete validated matrix", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "c2c-matrix-invalid-pass-"));
    temporaryRoots.push(temporary);
    const report = path.join(temporary, "report.json");
    await writeFile(report, JSON.stringify({
      schemaVersion: 5, verdict: "repository_pass", repositoryCommit: "a".repeat(40),
      repetitions: Array.from({ length: 30 }, () => ({})),
    }));

    const result = Bun.spawnSync([process.execPath, publisher, report], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
    const output = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(output).toContain("::error title=Novice matrix evidence::");
    expect(output).toContain("workflow_publication/report_invalid");
    expect(output).not.toContain(report);
  });
});

async function createFixture(mode: "missing" | "invalid" | "marker") {
  const root = await mkdtemp(path.join(os.tmpdir(), "c2c-matrix-fixture-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "quality", "scenarios"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "quality", "scenarios", "novice-daily-use.json"), JSON.stringify([{ id: "fresh.fixture" }]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.8.0-fixture.1" }));
  await writeFile(path.join(root, "tracked.txt"), "clean\n");
  const shardSource = mode === "missing" ? "process.exitCode = 0;\n"
    : mode === "invalid" ? "import { writeFile } from 'node:fs/promises'; const a=process.argv.slice(2); await writeFile(a[a.indexOf('--report')+1], '{');\n"
    : "import { writeFile } from 'node:fs/promises'; await writeFile('shard-ran', 'yes');\n";
  await writeFile(path.join(root, "scripts", "run-test-shard.mjs"), shardSource);
  git(root, ["init"]);
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]);
  return { root, report: path.join(root, "evidence", "matrix.json") };
}

function git(cwd: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("fixture git command failed");
}

function runMatrix(cwd: string, report: string) {
  return Bun.spawnSync([process.execPath, runner, "--repetitions", "1", "--report", report], { cwd, stdout: "pipe", stderr: "pipe" });
}

async function readJson(file: string) {
  return readFile(file, "utf8").then((value) => JSON.parse(value)).catch(() => null);
}

function expectBounded(report: any, fixtureRoot: string) {
  expect(report?.schemaVersion).toBe(1);
  expect(report?.verdict).toBe("fail");
  expect(report?.cleanup).toEqual({ attempted: expect.any(Boolean), succeeded: expect.any(Boolean) });
  const serialized = JSON.stringify(report);
  expect(serialized).not.toContain(fixtureRoot);
  expect(serialized).not.toContain("fixture@example.invalid");
  expect(serialized).not.toContain("stdout");
  expect(serialized).not.toContain("stderr");
}
