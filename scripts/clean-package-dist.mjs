#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.resolve(root, "dist");
if (path.dirname(dist) !== root || path.basename(dist) !== "dist") {
  throw new Error("Refusing unsafe distribution cleanup target.");
}
await rm(dist, { recursive: true, force: true });
