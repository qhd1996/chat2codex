const sensitivePatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /novice-secret-canary-[A-Za-z0-9_-]+/iu, label: "sensitive token canary" },
  { pattern: /prompt-canary[ \t]*:/iu, label: "sensitive prompt canary" },
  { pattern: /identity-canary(?:@|:)/iu, label: "sensitive identity canary" },
  { pattern: /Bearer[ \t]+[A-Za-z0-9._~+/-]{20,}/u, label: "sensitive bearer token" },
  { pattern: /(?:^|[^A-Za-z0-9])(?:sk|ghp)_[A-Za-z0-9_-]{20,}/u, label: "sensitive credential" },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, label: "sensitive private key" },
];
const unsafeRecovery = /(?:disable|bypass|ignore).{0,24}(?:trust|security|verification)|(?:delete|remove|purge).{0,24}(?:production|user data)|extend.{0,16}timeout/iu;

export interface NoviceGuidance {
  code: string;
  what_happened: string;
  safe_state: string;
  next_action: string;
}

export function assertNoviceOutputSafe(value: unknown): void {
  safeSerialize(value);
  for (const text of collectStrings(value)) {
    if (containsWindowsUserProfile(text)) throw new Error("Novice output must redact sensitive user path.");
    for (const { pattern, label } of sensitivePatterns) {
      if (pattern.test(text)) throw new Error("Novice output must redact " + label + ".");
    }
  }
  inspectGuidance(value);
}

function containsWindowsUserProfile(text: string): boolean {
  let normalized = text.replaceAll(String.fromCharCode(92), "/");
  while (normalized.includes("//")) normalized = normalized.replaceAll("//", "/");
  const lower = normalized.toLocaleLowerCase();
  let offset = 0;
  while (offset < lower.length) {
    const marker = lower.indexOf(":/users/", offset);
    if (marker < 0) return false;
    const drive = normalized[marker - 1];
    const remainder = normalized.slice(marker + ":/users/".length);
    const separator = remainder.indexOf("/");
    const identity = separator < 0 ? remainder : remainder.slice(0, separator);
    if (drive && /[A-Za-z]/u.test(drive) && identity && !(identity.startsWith("<") && identity.endsWith(">"))) return true;
    offset = marker + 1;
  }
  return false;
}

function collectStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [String(value)];
  if (seen.has(value)) throw new Error("Novice output cannot be safely redacted because it is cyclic.");
  seen.add(value);
  const output: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) output.push(...collectStrings(item, seen));
  } else {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) output.push(key, ...collectStrings(item, seen));
  }
  seen.delete(value);
  return output;
}

function inspectGuidance(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) inspectGuidance(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  const guidanceKeys = ["code", "what_happened", "safe_state", "next_action"];
  if (guidanceKeys.some((key) => Object.hasOwn(item, key))) {
    for (const key of guidanceKeys) {
      if (typeof item[key] !== "string" || item[key].length === 0 || item[key].length > 500) throw new Error("Novice guidance requires " + key + ".");
    }
    if (unsafeRecovery.test(item.next_action as string)) throw new Error("Novice recovery advice is unsafe.");
  }
  for (const nested of Object.values(item)) inspectGuidance(nested);
}

function safeSerialize(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    throw new Error("Novice output cannot be safely redacted because it is not serializable.");
  }
}
