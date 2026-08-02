#!/usr/bin/env node
import { runUserPromptSubmit } from "./hook-client.mjs";

const result = await main().catch(() => ({ exitCode: 2, stdout: "", stderr: "Desktop prompt blocked: local_configuration\n" }));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;

async function main() {
  const tokenPath = required("CHAT2CODEX_DESKTOP_PROMPT_TOKEN_FILE");
  const port = parsePort(required("CHAT2CODEX_DESKTOP_GATEWAY_PORT"));
  const expectedHost = "127.0.0.1:" + port;
  const { DesktopGatewayClient, loadScopedTokenFile } = await import("../../dist/desktop-gateway/client.js");
  const secret = await loadScopedTokenFile(tokenPath);
  try {
    const client = new DesktopGatewayClient({ port, expectedHost, role: "prompt_hook", keyId: required("CHAT2CODEX_DESKTOP_PROMPT_KEY_ID"), secret });
    return await runUserPromptSubmit(await readStdin(), { secret, request: (endpoint, body) => client.request(endpoint, body) });
  } finally { secret.fill(0); }
}

function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error("missing configuration"); return value; }
function parsePort(value) { const port = Number(value); if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid port"); return port; }
async function readStdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }
