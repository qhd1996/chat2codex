export interface DistributionDoctorSnapshot {
  platform: NodeJS.Platform;
  arch: string;
  windowsVersion: string;
  packageVersion: string;
  manifest: null | { packageVersion: string; schemaVersion: number; taskName: string; launcherPath: string };
  task?: { exists: boolean; taskName: string; launcherPath: string; lastResult?: number };
  process?: { writers: number; lockHealthy: boolean };
  stateSchemaVersion?: number;
  loopbackHost?: string;
  keys?: Array<{ role: string; path: string; formatValid: boolean; aclValid: boolean; fingerprint: string }>;
  hooks?: { expectedHashesMatch: boolean };
  desktop?: { available: boolean; version?: string };
}

export interface DistributionDoctorCheck {
  label: string; status: "ok" | "warn" | "error"; code: string; detail: string; recovery?: string;
}

export function diagnoseWindowsDistribution(value: DistributionDoctorSnapshot): DistributionDoctorCheck[] {
  if (!value.manifest) return [warn("Windows distribution", "DIST_NOT_INSTALLED", "No Windows installation manifest was found; foreground/source use remains available.")];
  const checks: DistributionDoctorCheck[] = [];
  if (value.platform !== "win32" || !["x64", "arm64"].includes(value.arch)) checks.push(error("Windows platform", "DIST_PLATFORM_UNSUPPORTED", `Unsupported ${value.platform}/${value.arch}.`, "Use supported Windows 10/11 x64; arm64 requires direct validation."));
  else checks.push(ok("Windows platform", "DIST_PLATFORM_OK", `${value.windowsVersion} ${value.arch}`));
  if (value.manifest.schemaVersion !== 1 || value.manifest.packageVersion !== value.packageVersion) checks.push(error("Package manifest", "DIST_PACKAGE_DRIFT", "Installed package and lifecycle manifest do not match.", "Reinstall the reviewed archive or restore the prior manifest/package pair."));
  else checks.push(ok("Package manifest", "DIST_PACKAGE_OK", value.packageVersion));
  if (!value.task?.exists || value.task.taskName !== value.manifest.taskName || same(value.task.launcherPath) !== same(value.manifest.launcherPath)) checks.push(error("Windows user task", "DIST_TASK_DRIFT", "Scheduled Task identity or launcher action does not match the manifest.", "Do not start it; rerun the reviewed service install transaction."));
  else checks.push(ok("Windows user task", "DIST_TASK_OK", `${value.task.taskName}; lastResult=${value.task.lastResult ?? "unknown"}`));
  if (value.process?.writers !== 1 || value.process.lockHealthy !== true) checks.push(error("Single writer", "DIST_WRITER_CONFLICT", "Expected exactly one healthy writer and lock.", "Stop and reconcile process ownership before restart or upgrade."));
  else checks.push(ok("Single writer", "DIST_WRITER_OK", "one writer and healthy lock"));
  if (value.stateSchemaVersion !== 6) checks.push(error("State schema", "DIST_SCHEMA_UNSUPPORTED", `Observed schema ${String(value.stateSchemaVersion)}; expected 6.`, "Restore a compatible backup or complete the reviewed migration."));
  else checks.push(ok("State schema", "DIST_SCHEMA_OK", "schema 6"));
  const expectedRoles = ["desktop_mcp", "prompt_hook", "stop_hook"];
  const keys = value.keys ?? [];
  const roles = keys.map((item) => item.role).sort();
  const fingerprints = keys.map((item) => item.fingerprint);
  const keysValid = keys.length === 3 && JSON.stringify(roles) === JSON.stringify(expectedRoles) &&
    keys.every((item) => item.formatValid && item.aclValid) && new Set(fingerprints).size === 3;
  if (!keysValid) checks.push(error("Gateway keys", "DIST_KEYS_INVALID", "Expected three distinct role-scoped owner-only keys.", "Do not rotate automatically; inspect paths/ACLs and restore or regenerate through the installer."));
  else checks.push(ok("Gateway keys", "DIST_KEYS_OK", "three distinct owner-only role keys"));
  if (value.loopbackHost !== "127.0.0.1") checks.push(error("Desktop Gateway bind", "DIST_LOOPBACK_INVALID", "Gateway is not pinned to IPv4 loopback.", "Disable the Gateway and restore 127.0.0.1 before use."));
  else checks.push(ok("Desktop Gateway bind", "DIST_LOOPBACK_OK", "127.0.0.1"));
  if (value.hooks?.expectedHashesMatch !== true) checks.push(error("Hook package hashes", "DIST_HOOK_HASH_DRIFT", "Packaged or observed Hook hashes differ from the manifest.", "Do not install or trust; reinstall the reviewed archive."));
  else checks.push(ok("Hook package hashes", "DIST_HOOK_HASH_OK", "manifest hashes match"));
  if (!value.desktop?.available) checks.push(warn("Codex Desktop", "DIST_DESKTOP_UNAVAILABLE", "Codex Desktop was not detected; installed behavior remains unproven."));
  else checks.push(ok("Codex Desktop", "DIST_DESKTOP_AVAILABLE", value.desktop.version ?? "available"));
  return checks;
}

function ok(label: string, code: string, detail: string): DistributionDoctorCheck { return { label, status: "ok", code, detail }; }
function warn(label: string, code: string, detail: string): DistributionDoctorCheck { return { label, status: "warn", code, detail }; }
function error(label: string, code: string, detail: string, recovery: string): DistributionDoctorCheck { return { label, status: "error", code, detail, recovery }; }
function same(value: string): string { return value.replace(/\//gu, "\\").toLocaleLowerCase(); }
