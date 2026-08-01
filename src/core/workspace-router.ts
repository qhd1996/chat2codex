import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { configuredWorkspaceKinds, type ConfiguredWorkspaceKind } from "../config/env.js";
import type { WorkspaceKind } from "../state/types.js";

export interface WorkspaceRoute { kind: ConfiguredWorkspaceKind; root: string; aliases: string[]; }
export interface WorkspaceResolution { kind: WorkspaceKind; root: string; explicit: boolean; }

const aliases: Record<ConfiguredWorkspaceKind, string[]> = {
  work: ["work", "工作", "代码", "项目"], travel: ["travel", "旅行", "旅游", "酒店", "机票"], personal: ["personal", "个人", "生活"], finance: ["finance", "金融", "投资", "股票", "财报"], ai_lab: ["ai", "ai-lab", "人工智能", "智能体"], learning: ["learning", "学习", "课程", "教材"],
};

export class WorkspaceRouter {
  private constructor(private readonly routes: WorkspaceRoute[], private readonly groupRoots: string[]) {}
  static async create(config: Record<string, string>, groupAllowedRoots: string[]): Promise<WorkspaceRouter> {
    const entries: WorkspaceRoute[] = []; const seen = new Set<string>();
    for (const kind of configuredWorkspaceKinds) {
      const configured = config[kind]; if (!configured) continue;
      const root = await requiredDirectory(configured); const key = platformKey(root);
      if (seen.has(key)) throw new Error("Workspace routes contain duplicate canonical directories.");
      seen.add(key); entries.push({ kind, root, aliases: aliases[kind] });
    }
    if (!entries.length) throw new Error("At least one workspace route is required.");
    const roots = await Promise.all(groupAllowedRoots.map(requiredDirectory));
    return new WorkspaceRouter(entries, roots);
  }
  list(): WorkspaceRoute[] { return this.routes.map((route) => ({ ...route, aliases: [...route.aliases] })); }
  resolveKind(kind: WorkspaceKind): WorkspaceResolution { if (kind === "explicit") throw new Error("Explicit workspace requires a path."); const route = this.routes.find((item) => item.kind === kind); if (!route) throw new Error("Workspace route is not configured: " + kind); return { kind, root: route.root, explicit: false }; }
  resolveAlias(value: string): WorkspaceRoute | undefined { const key = value.trim().toLocaleLowerCase(); return this.routes.find((route) => route.aliases.some((alias) => alias.toLocaleLowerCase() === key)); }
  candidatesForClassifier() { return this.routes.map((route) => ({ kind: route.kind, root: route.root, aliases: [...route.aliases] })); }
  async resolveExplicit(candidate: string, chatType: "direct" | "group"): Promise<WorkspaceResolution> {
    const root = await requiredDirectory(candidate);
    if (chatType === "group" && !this.groupRoots.some((allowed) => inside(allowed, root))) throw new Error("Explicit workspace is outside the allowed group roots.");
    return { kind: "explicit", root, explicit: true };
  }
}

async function requiredDirectory(value: string): Promise<string> { const resolved = path.resolve(value); const info = await stat(resolved).catch(() => null); if (!info?.isDirectory()) throw new Error("Workspace route must be an existing directory: " + resolved); return realpath(resolved); }
function inside(root: string, candidate: string): boolean { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function platformKey(value: string): string { return process.platform === "win32" ? value.toLocaleLowerCase() : value; }
