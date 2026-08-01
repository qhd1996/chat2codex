import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const isWindows = process.platform === "win32";

export function expectPrivateFileMode(mode: number): void {
  if (!isWindows && (mode & 0o777) !== 0o600) {
    throw new Error("Expected private file mode 0600");
  }
}

export async function createNodeTestExecutable(
  directory: string,
  name: string,
  source: string,
): Promise<string> {
  const script = path.join(directory, name + ".cjs");
  await writeFile(script, source);
  return createNodeTestLauncher(script);
}

export async function createNodeTestLauncher(script: string): Promise<string> {
  if (!isWindows) {
    await chmod(script, 0o755);
    return script;
  }
  const launcher = script.replace(/\.cjs$/iu, ".cmd");
  const scriptName = path.basename(script);
  await writeFile(launcher, "@echo off\r\nnode \"%~dp0" + scriptName + "\" %*\r\n");
  return launcher;
}

export async function supportsFileSymlinks(): Promise<boolean> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chat2codex-symlink-probe-"));
  try {
    const target = path.join(directory, "target.txt");
    const link = path.join(directory, "link.txt");
    await writeFile(target, "probe");
    await symlink(target, link, "file");
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (isWindows && (code === "EPERM" || code === "EACCES")) return false;
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
