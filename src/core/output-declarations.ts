const declarationPrefix = "CHAT2CODEX_OUTPUT_FILES: ";
const maxDeclaredFiles = 16;
const maxDeclarationScanChars = 1_048_576;
const maxDeclarationErrorChars = 256;

export interface ParsedOutputDeclaration {
  visibleText: string;
  outputFiles: string[];
  error?: string;
}

interface CandidateLine {
  start: number;
  end: number;
  text: string;
}

export function parseOutputDeclaration(fullText: string): ParsedOutputDeclaration {
  if (fullText.length > maxDeclarationScanChars) {
    return declarationError(
      fullText,
      "Output declaration could not be validated within the bounded scan window.",
    );
  }
  const scannedText = fullText;
  if (!scannedText.includes(declarationPrefix)) {
    return { visibleText: fullText, outputFiles: [] };
  }

  const candidates = findCandidateLines(scannedText);
  if (candidates.length === 0) {
    return { visibleText: fullText, outputFiles: [] };
  }
  if (candidates.length > 1) {
    return declarationError(
      fullText,
      "CHAT2CODEX_OUTPUT_FILES may appear only once outside a code fence.",
    );
  }

  const candidate = candidates[0]!;
  const contentEnd = endBeforeOptionalLineEnding(scannedText);
  if (candidate.end !== contentEnd) {
    return declarationError(
      fullText,
      "CHAT2CODEX_OUTPUT_FILES must be the final control line.",
    );
  }

  const visibleText = removeFinalControlLine(fullText, candidate.start);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.text.slice(declarationPrefix.length));
  } catch {
    return declarationError(
      visibleText,
      "CHAT2CODEX_OUTPUT_FILES must contain valid JSON.",
    );
  }
  if (!Array.isArray(parsed)) {
    return declarationError(
      visibleText,
      "CHAT2CODEX_OUTPUT_FILES must contain a JSON array.",
    );
  }
  if (parsed.length > maxDeclaredFiles) {
    return declarationError(
      visibleText,
      "CHAT2CODEX_OUTPUT_FILES may contain at most 16 paths.",
    );
  }
  if (!parsed.every((entry) => typeof entry === "string")) {
    return declarationError(
      visibleText,
      "CHAT2CODEX_OUTPUT_FILES must contain only string paths.",
    );
  }
  if (parsed.some((entry) => entry.trim().length === 0)) {
    return declarationError(
      visibleText,
      "CHAT2CODEX_OUTPUT_FILES paths must be non-empty.",
    );
  }

  return {
    visibleText,
    outputFiles: parsed,
  };
}

function findCandidateLines(text: string): CandidateLine[] {
  const candidates: CandidateLine[] = [];
  let lineStart = 0;
  let fenceMarker: string | undefined;

  while (lineStart <= text.length) {
    const newlineIndex = text.indexOf("\n", lineStart);
    const physicalEnd = newlineIndex === -1 ? text.length : newlineIndex;
    const contentEnd = physicalEnd > lineStart && text[physicalEnd - 1] === "\r"
      ? physicalEnd - 1
      : physicalEnd;
    const line = text.slice(lineStart, contentEnd);
    const fence = parseFenceMarker(line);

    if (fenceMarker === undefined) {
      if (fence) {
        fenceMarker = fence;
      } else if (line.startsWith(declarationPrefix)) {
        candidates.push({ start: lineStart, end: contentEnd, text: line });
      }
    } else if (
      fence !== undefined &&
      fence[0] === fenceMarker[0] &&
      fence.length >= fenceMarker.length
    ) {
      fenceMarker = undefined;
    }

    if (newlineIndex === -1) {
      break;
    }
    lineStart = newlineIndex + 1;
  }

  return candidates;
}

function parseFenceMarker(line: string): string | undefined {
  const trimmed = line.startsWith("   ")
    ? line.slice(3)
    : line.startsWith("  ")
      ? line.slice(2)
      : line.startsWith(" ")
        ? line.slice(1)
        : line;
  const marker = trimmed[0];
  if (marker !== String.fromCharCode(96) && marker !== "~") {
    return undefined;
  }
  let markerLength = 1;
  while (trimmed[markerLength] === marker) {
    markerLength += 1;
  }
  return markerLength >= 3 ? marker.repeat(markerLength) : undefined;
}

function endBeforeOptionalLineEnding(text: string): number {
  if (text.endsWith("\r\n")) {
    return text.length - 2;
  }
  if (text.endsWith("\n") || text.endsWith("\r")) {
    return text.length - 1;
  }
  return text.length;
}

function removeFinalControlLine(text: string, lineStart: number): string {
  if (lineStart === 0) {
    return "";
  }
  let visibleEnd = lineStart;
  if (text[visibleEnd - 1] === "\n") {
    visibleEnd -= 1;
    if (visibleEnd > 0 && text[visibleEnd - 1] === "\r") {
      visibleEnd -= 1;
    }
  }
  return text.slice(0, visibleEnd);
}

function declarationError(visibleText: string, error: string): ParsedOutputDeclaration {
  return {
    visibleText,
    outputFiles: [],
    error: error.slice(0, maxDeclarationErrorChars),
  };
}
