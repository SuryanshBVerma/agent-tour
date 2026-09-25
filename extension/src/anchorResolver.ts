import * as vscode from "vscode";
import { TourStep } from "./types";

/** How far above and below the declared start line to look before searching the whole file. */
const NEARBY_LINES = 50;

export type Resolution =
  /** Anchor found on the declared start line. */
  | { status: "exact"; range: vscode.Range }
  /** Anchor found elsewhere; the range keeps its length and moves by `delta` lines. */
  | { status: "relocated"; range: vscode.Range; delta: number }
  /** Anchor not found; `range` is the declared range, clamped to the document. */
  | { status: "stale"; range: vscode.Range };

/**
 * Maps a step onto the document as it is now. Tours are written against the code at
 * one moment; later edits shift lines, so the anchor (a snippet of the step's first
 * line) is used to find where the step went. Nearest match wins; exact text is
 * preferred over a whitespace-insensitive match.
 */
export function resolveStep(document: vscode.TextDocument, step: TourStep): Resolution {
  const declaredStart = step.range.start - 1;
  const length = Math.max(0, step.range.end - step.range.start);
  const anchor = step.anchor.trim();

  if (anchor.length > 0) {
    const exact = exactMatcher(anchor);
    const loose = looseMatcher(anchor);
    // A reformatted line near the declared spot beats an identical line far away.
    const passes: [LineMatcher, number][] = [
      [exact, NEARBY_LINES],
      [loose, NEARBY_LINES],
      [exact, Infinity],
      [loose, Infinity],
    ];
    for (const [matches, maxDistance] of passes) {
      const line = nearestMatch(document, declaredStart, matches, maxDistance);
      if (line !== undefined) {
        const range = lineRange(document, line, line + length);
        return line === declaredStart
          ? { status: "exact", range }
          : { status: "relocated", range, delta: line - declaredStart };
      }
    }
  }
  return { status: "stale", range: lineRange(document, declaredStart, declaredStart + length) };
}

type LineMatcher = (text: string) => boolean;

function exactMatcher(anchor: string): LineMatcher {
  return (text) => text.includes(anchor);
}

/** Tolerates re-indentation and reformatting that only changes whitespace. */
function looseMatcher(anchor: string): LineMatcher {
  const target = collapseWhitespace(anchor);
  return (text) => collapseWhitespace(text).includes(target);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * Searches outward from `origin` (declared line first, then ±1, ±2, …) up to
 * `maxDistance` lines. Ties go to the line above, which is where code usually ends up
 * when lines are deleted. `origin` may lie past the end of the file.
 */
function nearestMatch(
  document: vscode.TextDocument,
  origin: number,
  matches: LineMatcher,
  maxDistance: number,
): number | undefined {
  const last = document.lineCount - 1;
  const limit = Math.min(maxDistance, Math.max(origin, last - origin, 0));
  for (let distance = 0; distance <= limit; distance++) {
    for (const line of distance === 0 ? [origin] : [origin - distance, origin + distance]) {
      if (line >= 0 && line <= last && matches(document.lineAt(line).text)) {
        return line;
      }
    }
  }
  return undefined;
}

/** Clamped, 0-based whole-line range from `startLine` to `endLine` inclusive. */
export function lineRange(document: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
  const last = document.lineCount - 1;
  const start = Math.min(Math.max(startLine, 0), last);
  const end = Math.min(Math.max(endLine, start), last);
  return new vscode.Range(start, 0, end, document.lineAt(end).range.end.character);
}

/** "3 lines down", "1 line up". */
export function formatDelta(delta: number): string {
  const lines = Math.abs(delta) === 1 ? "line" : "lines";
  return `${Math.abs(delta)} ${lines} ${delta < 0 ? "up" : "down"}`;
}
