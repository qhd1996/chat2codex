import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const minimumNode = [20, 19, 0];
const allowedCommands = new Set([
  "context", "doctor", "instructions", "list", "schemas",
  "show", "status", "templates", "validate",
]);

export function buildLocalOpenSpecInvocation({ repositoryRoot, nodeVersion, args, environment }) {
  if (!satisfiesMinimumNode(nodeVersion)) {
    throw new Error("Local OpenSpec requires Node.js 20.19.0 or newer.");
  }
  if (!Array.isArray(args) || args.length === 0 || !allowedCommands.has(args[0])) {
    throw new Error(`OpenSpec command is not allowed by the repository wrapper: ${String(args?.[0] ?? "<missing>")}`);
  }
  const root = path.resolve(repositoryRoot);
  const cli = path.join(root, "node_modules", "@fission-ai", "openspec", "bin", "openspec.js");
  return {
    executable: process.execPath,
    args: [cli, ...args],
    options: {
      cwd: root,
      env: {
        ...environment,
        OPENSPEC_TELEMETRY: "0",
        OPENSPEC_NO_UPDATE_CHECK: "1",
        DO_NOT_TRACK: "1",
        NO_COLOR: "1",
        CI: "1",
      },
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    },
  };
}

function satisfiesMinimumNode(version) {
  const parts = String(version).replace(/^v/u, "").split(".").map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isSafeInteger(part) || part < 0)) return false;
  for (let index = 0; index < minimumNode.length; index += 1) {
    if (parts[index] > minimumNode[index]) return true;
    if (parts[index] < minimumNode[index]) return false;
  }
  return true;
}

function isMain() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  try {
    const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
    const invocation = buildLocalOpenSpecInvocation({
      repositoryRoot, nodeVersion: process.versions.node, args: process.argv.slice(2), environment: process.env,
    });
    const result = spawnSync(invocation.executable, invocation.args, invocation.options);
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    process.stderr.write(`local-openspec: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
