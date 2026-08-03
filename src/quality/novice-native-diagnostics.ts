export interface NativeLifecycleFailure {
  stage: string;
  exceptionType: string;
  code: string;
  errno: number | null;
  hResult: number | null;
}

export function nativeLifecycleFailure(stage: string, error: unknown): NativeLifecycleFailure {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return {
    stage: bounded(stage, 64),
    exceptionType: bounded(typeof value.name === "string" ? value.name : error instanceof Error ? error.name : typeof error, 160),
    code: bounded(typeof value.code === "string" ? value.code : "unavailable", 64),
    errno: integer(value.errno),
    hResult: integer(value.hResult),
  };
}

function bounded(value: string, max: number): string { return value.slice(0, max) || "unavailable"; }
function integer(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) ? value : null; }
