export interface FailureDetail {
  stage: string;
  exitCode: number | null;
  signal: string | null;
  exceptionType: string;
  hResult: number | null;
  nativeCode: number | null;
  fullyQualifiedErrorId: string;
  category: string;
  stderrTail: string[];
  stdoutTail: string[];
}

export const failureDetailPrefix = "CHAT2CODEX_FAILURE_DETAIL ";

export function failureDetailFrom(error: unknown): FailureDetail | undefined {
  if (!error || typeof error !== "object" || !("failureDetail" in error)) return undefined;
  const value = (error as { failureDetail?: unknown }).failureDetail;
  if (!isRecord(value) || typeof value.stage !== "string") return undefined;
  return value as unknown as FailureDetail;
}

export function renderFailureDetailLine(error: unknown): string | undefined {
  const detail = failureDetailFrom(error);
  return detail ? failureDetailPrefix + JSON.stringify(detail) : undefined;
}

export function parseFailureDetailLine(line: string): FailureDetail | undefined {
  if (!line.startsWith(failureDetailPrefix) || line.length > 4096) return undefined;
  try {
    const parsed = JSON.parse(line.slice(failureDetailPrefix.length));
    if (!isRecord(parsed)) return undefined;
    const allowed = ["stage", "exitCode", "signal", "exceptionType", "hResult", "nativeCode", "fullyQualifiedErrorId", "category", "stderrTail", "stdoutTail"];
    if (Object.keys(parsed).some((key) => !allowed.includes(key))) return undefined;
    if (typeof parsed.stage !== "string" || typeof parsed.exceptionType !== "string" || typeof parsed.fullyQualifiedErrorId !== "string" || typeof parsed.category !== "string") return undefined;
    if (!validNullableInteger(parsed.exitCode) || !validNullableInteger(parsed.hResult) || !validNullableInteger(parsed.nativeCode)) return undefined;
    if (parsed.signal !== null && typeof parsed.signal !== "string") return undefined;
    if (!validLines(parsed.stderrTail) || !validLines(parsed.stdoutTail)) return undefined;
    return parsed as unknown as FailureDetail;
  } catch { return undefined; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validNullableInteger(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isSafeInteger(value)); }
function validLines(value: unknown): boolean { return Array.isArray(value) && value.length <= 4 && value.every((line) => typeof line === "string" && line.length <= 512); }
