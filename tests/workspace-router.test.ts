import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceRouter } from "../src/core/workspace-router.js";
import { loadConfig } from "../src/config/env.js";
import { supportsFileSymlinks } from "./helpers/platform.js";

describe("WorkspaceRouter", () => {
  test("resolves six configured workspaces and aliases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-routes-"));
    try {
      const routes = Object.fromEntries(["work", "travel", "personal", "finance", "ai_lab", "learning"].map((kind) => [kind, path.join(root, kind)]));
      await Promise.all(Object.values(routes).map((directory) => mkdir(directory)));
      const config = loadConfig({ CHAT2CODEX_ADAPTER: "weixin", CODEX_WORKDIR: routes.work, CHAT2CODEX_WORKSPACE_ROUTES: JSON.stringify(routes) });
      const router = await WorkspaceRouter.create(config.workspaceRoutes, config.codexGroupAllowedRoots);
      expect(router.list()).toHaveLength(6);
      expect(router.resolveKind("learning").root).toBe(await realpath(routes.learning));
      expect(router.resolveAlias("课程")?.kind).toBe("learning");
      expect(router.resolveAlias("AI")?.kind).toBe("ai_lab");
      expect(router.candidatesForClassifier().map((item) => item.kind)).toEqual(["work", "travel", "personal", "finance", "ai_lab", "learning"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("falls back to one work route and rejects malformed or duplicate config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-route-default-"));
    try {
      const fallback = loadConfig({ CHAT2CODEX_ADAPTER: "weixin", CODEX_WORKDIR: root });
      expect(fallback.workspaceRoutes).toEqual({ work: path.resolve(root) });
      expect(() => loadConfig({ CHAT2CODEX_ADAPTER: "weixin", CODEX_WORKDIR: root, CHAT2CODEX_WORKSPACE_ROUTES: '{"work":"x","extra":"y"}' })).toThrow();
      const same = path.join(root, "same"); await mkdir(same);
      expect(() => loadConfig({ CHAT2CODEX_ADAPTER: "weixin", CODEX_WORKDIR: root, CHAT2CODEX_WORKSPACE_ROUTES: JSON.stringify({ work: same, travel: same, personal: path.join(root, "p"), finance: path.join(root, "f"), ai_lab: path.join(root, "a"), learning: path.join(root, "l") }) })).toThrow(/duplicate/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("validates existing directories and group explicit-path boundaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat2codex-route-policy-"));
    const allowed = path.join(root, "allowed"); const outside = path.join(root, "outside"); await mkdir(allowed); await mkdir(outside);
    try {
      const router = await WorkspaceRouter.create({ work: allowed }, [allowed]);
      expect((await router.resolveExplicit(outside, "direct")).root).toBe(await realpath(outside));
      await expect(router.resolveExplicit(outside, "group")).rejects.toThrow(/allowed/i);
      await expect(router.resolveExplicit(path.join(root, "missing"), "direct")).rejects.toThrow(/directory/i);
      if (await supportsFileSymlinks()) { const link = path.join(allowed, "escape"); await symlink(outside, link, "dir"); await expect(router.resolveExplicit(link, "group")).rejects.toThrow(/allowed/i); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
