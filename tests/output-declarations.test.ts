import { describe, expect, test } from "bun:test";

import { parseOutputDeclaration } from "../src/core/output-declarations.js";

const declaredFiles = ["C:\\absolute\\report.png", "C:\\absolute\\notes.pdf"];
const declaration = "CHAT2CODEX_OUTPUT_FILES: " + JSON.stringify(declaredFiles);

describe("output declarations", () => {
  test("returns declared files in order and removes the final control line", () => {
    expect(parseOutputDeclaration("Finished.\n" + declaration)).toEqual({
      visibleText: "Finished.",
      outputFiles: declaredFiles,
    });
  });

  test("returns no files when there is no declaration", () => {
    expect(parseOutputDeclaration("Saved C:\\absolute\\report.png.")).toEqual({
      visibleText: "Saved C:\\absolute\\report.png.",
      outputFiles: [],
    });
  });

  test.each([
    ["a non-final control line", declaration + "\nMore visible text.", /final control line/i],
    [
      "malformed JSON",
      'Done.\nCHAT2CODEX_OUTPUT_FILES: ["C:\\\\bad"',
      /valid JSON/i,
    ],
    [
      "a non-array value",
      'Done.\nCHAT2CODEX_OUTPUT_FILES: {"path":"C:\\\\bad"}',
      /JSON array/i,
    ],
    [
      "a non-string entry",
      'Done.\nCHAT2CODEX_OUTPUT_FILES: ["C:\\\\ok",7]',
      /string paths/i,
    ],
    ["an empty path", 'Done.\nCHAT2CODEX_OUTPUT_FILES: ["   "]', /non-empty/i],
    ["duplicate control lines", declaration + "\n" + declaration, /only once/i],
    [
      "more than sixteen entries",
      "Done.\nCHAT2CODEX_OUTPUT_FILES: " +
        JSON.stringify(Array.from({ length: 17 }, (_, index) => "C:\\out\\" + index + ".png")),
      /at most 16/i,
    ],
    [
      "a declaration outside the bounded scan window",
      declaration + "\n" + "x".repeat(1_048_576),
      /bounded scan window/i,
    ],
  ])("rejects %s with a bounded error and no files", (_name, text, errorPattern) => {
    const result = parseOutputDeclaration(text);

    expect(result.outputFiles).toEqual([]);
    expect(result.error).toMatch(errorPattern);
    expect(result.error!.length).toBeLessThanOrEqual(256);
  });

  test("ignores ordinary mentions and declaration-shaped text in code fences", () => {
    const text = [
      "Changed files: C:\\repo\\src\\index.ts",
      'Command output mentioned CHAT2CODEX_OUTPUT_FILES: ["C:\\\\not-a-control-line.png"] inline.',
      "\u0060\u0060\u0060text",
      declaration,
      "\u0060\u0060\u0060",
      "The input file was C:\\input\\photo.png.",
    ].join("\n");

    expect(parseOutputDeclaration(text)).toEqual({ visibleText: text, outputFiles: [] });
  });

  test("does not close a longer code fence with a shorter fence", () => {
    const marker = String.fromCharCode(96);
    const text = [
      marker.repeat(4) + "text",
      marker.repeat(3),
      declaration,
      marker.repeat(4),
    ].join("\n");

    expect(parseOutputDeclaration(text)).toEqual({ visibleText: text, outputFiles: [] });
  });

  test("accepts a final control line followed only by a line ending", () => {
    expect(parseOutputDeclaration("Finished.\r\n" + declaration + "\r\n")).toEqual({
      visibleText: "Finished.",
      outputFiles: declaredFiles,
    });
  });
});
