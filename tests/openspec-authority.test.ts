import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { validateOpenSpecAuthority } from "../scripts/verify-openspec-authority.mjs";

const authorityCommit = "21a5800c4d725375af256a1e1c827bab75c3f034";
const authorityRepo = "F:/workspace/chat2codex-custom/.worktrees/requirements-ledger/docs/requirements/";
const changeName = "minimal-quality-acceleration";
const prohibitedTask = "019fc002-590e-7023-b7e5-2a802168f00a";
const approvedLock = JSON.parse(await readFile(path.resolve(import.meta.dir, "..", "quality", "authority", "requirements-ledger.json"), "utf8"));

const metadata = (overrides: Record<string, unknown> = {}) => ({
  changeName,
  authorityRepo,
  authorityCommit,
  requirementIds: ["OPS-001", "OPS-003", "OPS-004"],
  acceptedBy: "Haoda",
  productionAuthorized: false,
  realExternalActionsAuthorized: false,
  ...overrides,
});

const artifact = (kind: string, overrides: Record<string, unknown> = {}, body = "## Purpose\n\nRepository quality only.") =>
  `<!-- chat2codex-authority ${JSON.stringify(metadata({ artifact: kind, ...overrides }))} -->\n\n${body}\n`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-openspec-authority-"));
  const changeRoot = path.join(root, "openspec", "changes", changeName);
  const specRoot = path.join(changeRoot, "specs", "quality-gates");
  await mkdir(specRoot, { recursive: true });
  const files = {
    proposal: path.join(changeRoot, "proposal.md"),
    specs: path.join(specRoot, "spec.md"),
    design: path.join(changeRoot, "design.md"),
    tasks: path.join(changeRoot, "tasks.md"),
  } as const;
  for (const [kind, file] of Object.entries(files)) await writeFile(file, artifact(kind));
  return { root, changeRoot, files };
}

async function withFixture(run: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const value = await fixture();
  try {
    await run(value);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
}

describe("OpenSpec authority overlay", () => {
  test("accepts one complete ledger-bound change", async () => {
    await withFixture(async ({ changeRoot }) => {
      await expect(validateOpenSpecAuthority({
        changeRoot,
        lock: validLock(),
      })).resolves.toEqual({ changeName, artifactCount: 4, requirementIds: ["OPS-001", "OPS-003", "OPS-004"] });
    });
  });

  test("the approved lock includes the reusable distribution requirements and overnight CRs", () => {
    expect(approvedLock.authorityCommit).toBe(authorityCommit);
    for (const changeId of ["CR-0006", "CR-0007"]) expect(approvedLock.acceptedChangeIds).toContain(changeId);
    for (const requirementId of ["DIST-001", "DIST-002", "DIST-003"]) expect(approvedLock.requirementIds).toContain(requirementId);
    const lockedPaths = approvedLock.files.map((file: { path: string }) => file.path);
    expect(lockedPaths).toContain("docs/requirements/changes/CR-0006-reusable-windows-distribution.md");
    expect(lockedPaths).toContain("docs/requirements/changes/CR-0007-overnight-repository-autonomy.md");
  });

  for (const [name, override, pattern] of [
    ["wrong authority commit", { authorityCommit: "a".repeat(40) }, /authority commit/i],
    ["wrong authority repository", { authorityRepo: "F:/other/requirements/" }, /authority repo/i],
    ["unknown requirement ID", { requirementIds: ["OPS-001", "UNKNOWN-999"] }, /unknown requirement/i],
    ["production authorization", { productionAuthorized: true }, /production.*not authorized/i],
    ["external-action authorization", { realExternalActionsAuthorized: true }, /external action.*not authorized/i],
    ["unknown metadata", { credential: "unexpected" }, /unknown.*metadata/i],
  ] as const) {
    test(`rejects ${name}`, async () => {
      await withFixture(async ({ changeRoot, files }) => {
        await writeFile(files.proposal, artifact("proposal", override));
        await expect(validateOpenSpecAuthority({ changeRoot, lock: validLock() })).rejects.toThrow(pattern);
      });
    });
  }

  test("rejects missing metadata and inconsistent change identity", async () => {
    await withFixture(async ({ changeRoot, files }) => {
      await writeFile(files.proposal, "# Missing metadata\n");
      await expect(validateOpenSpecAuthority({ changeRoot, lock: validLock() })).rejects.toThrow(/metadata/i);
      await writeFile(files.proposal, artifact("proposal", { changeName: "different-change" }));
      await expect(validateOpenSpecAuthority({ changeRoot, lock: validLock() })).rejects.toThrow(/change name/i);
    });
  });

  test("rejects authority inflation and the prohibited damaged task", async () => {
    await withFixture(async ({ changeRoot, files }) => {
      await writeFile(files.design, artifact("design", {}, "OpenSpec is the authoritative requirements source."));
      await expect(validateOpenSpecAuthority({ changeRoot, lock: validLock() })).rejects.toThrow(/authority inflation/i);
      await writeFile(files.design, artifact("design", {}, `Replay task ${prohibitedTask}.`));
      await expect(validateOpenSpecAuthority({ changeRoot, lock: validLock() })).rejects.toThrow(/prohibited task/i);
    });
  });

  test("rejects an authority lock that claims authority or has unknown fields", async () => {
    await withFixture(async ({ changeRoot }) => {
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), authoritative: true } })).rejects.toThrow(/lock.*non-authoritative/i);
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), extra: true } })).rejects.toThrow(/unknown.*lock/i);
    });
  });

  test("rejects duplicate lock identities and malformed locked files", async () => {
    await withFixture(async ({ changeRoot }) => {
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), requirementIds: ["OPS-001", "OPS-001", "OPS-003", "OPS-004"] } })).rejects.toThrow(/duplicate.*requirement/i);
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), acceptedChangeIds: ["CR-0001", "CR-0001"] } })).rejects.toThrow(/duplicate.*change/i);
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), files: [{ ...validLockFile(), path: "../outside.md" }] } })).rejects.toThrow(/lock.*path/i);
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), files: [{ ...validLockFile(), sha256: "bad" }] } })).rejects.toThrow(/lock.*sha/i);
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), files: [{ ...validLockFile(), extra: true }] } })).rejects.toThrow(/unknown.*file/i);
    });
  });

  test("rejects changing both the lock and every artifact to a different authority root", async () => {
    await withFixture(async ({ changeRoot, files }) => {
      const changedCommit = "b".repeat(40);
      const changedRepo = "F:/other/requirements/docs/requirements/";
      for (const [kind, file] of Object.entries(files)) {
        await writeFile(file, artifact(kind, { authorityCommit: changedCommit, authorityRepo: changedRepo }));
      }
      await expect(validateOpenSpecAuthority({
        changeRoot, lock: { ...validLock(), authorityCommit: changedCommit, authorityRepo: changedRepo },
      })).rejects.toThrow(/approved authority (?:commit|repo)/i);
    });
  });

  test("rejects drift in the accepted CRs, requirement closure, or locked file hashes", async () => {
    await withFixture(async ({ changeRoot }) => {
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), acceptedChangeIds: ["CR-0001", "CR-0002", "CR-0005"] } })).rejects.toThrow(/accepted change.*snapshot/i);
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), requirementIds: [...validLock().requirementIds, "FAKE-999"] } })).rejects.toThrow(/requirement.*snapshot/i);
      await expect(validateOpenSpecAuthority({ changeRoot, lock: { ...validLock(), files: [{ ...validLockFile(), sha256: "b".repeat(64) }] } })).rejects.toThrow(/file.*snapshot/i);
    });
  });
});

function validLock() {
  return structuredClone(approvedLock);
}

function validLockFile() {
  return structuredClone(approvedLock.files[0]);
}
