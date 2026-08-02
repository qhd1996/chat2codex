import fs from "node:fs/promises";

const [file = "tests/message-router.test.ts", shardCountText = "8"] = process.argv.slice(2);
const shardCount = Number(shardCountText);
const source = await fs.readFile(file, "utf8");
const names = [];
for (const match of source.matchAll(/\b(?:test|symlinkTest)\([ \t]*"((?:[^"\\]|\\.)*)"/gu)) {
  names.push(JSON.parse(`"${match[1]}"`));
}
if (!Number.isSafeInteger(shardCount) || shardCount <= 0 || names.length === 0) throw new Error("invalid shard input");
if (new Set(names).size !== names.length) throw new Error("duplicate test names prevent deterministic sharding");
for (const name of names) {
  if (names.some((candidate) => candidate !== name && candidate.endsWith(name))) {
    throw new Error(`test-name suffix collision prevents exact sharding: ${name}`);
  }
}
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\$&");
const shards = Array.from({ length: shardCount }, () => []);
names.forEach((name, index) => shards[index % shardCount].push(name));
console.log(JSON.stringify({
  file,
  testCount: names.length,
  shardCount,
  shards: shards.map((items, index) => ({
    index, count: items.length, names: items,
    pattern: `(?:${items.map(escape).join("|")})$`,
  })),
}, null, 2));
