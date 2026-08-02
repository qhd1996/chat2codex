#!/usr/bin/env node
import { runStopWake } from "./hook-client.mjs";

await main().catch(() => undefined);
process.exitCode = 0;

async function main() {
  const tokenPath = required("CHAT2CODEX_DESKTOP_STOP_TOKEN_FILE");
  const port = parsePort(required("CHAT2CODEX_DESKTOP_GATEWAY_PORT"));
  const { DesktopGatewayClient, loadScopedTokenFile } = await import("../../dist/desktop-gateway/client.js");
  const secret = await loadScopedTokenFile(tokenPath);
  try {
    const client = new DesktopGatewayClient({ port, expectedHost: "127.0.0.1:" + port, role: "stop_hook", keyId: required("CHAT2CODEX_DESKTOP_STOP_KEY_ID"), secret });
    await runStopWake(await readStdin(), { request: (endpoint, body) => client.request(endpoint, body) });
  } finally { secret.fill(0); }
}

function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error("missing configuration"); return value; }
function parsePort(value) { const port = Number(value); if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid port"); return port; }
async function readStdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }
