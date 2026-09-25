// No vscode import: shared with the bundled skill validator, which runs under plain node.
import { Tour, TourStep } from "./types";

export interface LintMessage {
  severity: "error" | "warning";
  /** Step index, or undefined for tour-level messages. */
  step?: number;
  message: string;
}

/** Returns file contents for a workspace-relative path, or undefined if it does not exist. */
export type ReadFile = (relativePath: string) => string | undefined;

/** Hard limit: longer tours are not reviews, they are rewrites. */
export const MAX_STEPS = 20;
/** Guidance from the skill; outside this range is a warning. */
export const TARGET_STEPS = { min: 3, max: 12 };
export const TARGET_MAX_LINES = 40;
/** The card is a hover; longer text scrolls and stops being read. */
export const MAX_DESCRIPTION_CHARS = 1000;
/** Anchor guidance from the skill: long enough to be distinctive, short enough to survive edits. */
export const TARGET_ANCHOR_LENGTH = { min: 10, max: 80 };

/**
 * Checks a schema-valid tour against the files it points at. Errors mean the tour will
 * play wrong (missing file, range past the end, anchor not on the start line, overlaps);
 * warnings flag tours that will play but review poorly.
 */
export function lintTour(tour: Tour, readFile: ReadFile): LintMessage[] {
  const messages: LintMessage[] = [];
  const error = (message: string, step?: number) => messages.push({ severity: "error", step, message });
  const warn = (message: string, step?: number) => messages.push({ severity: "warning", step, message });

  const count = tour.steps.length;
  if (count > MAX_STEPS) {
    error(`tour has ${count} steps; the maximum is ${MAX_STEPS}. Group related hunks or move trivial ones to the summary`);
  } else if (count < TARGET_STEPS.min || count > TARGET_STEPS.max) {
    warn(`tour has ${count} steps; aim for ${TARGET_STEPS.min}–${TARGET_STEPS.max}`);
  }
  if (!tour.summary.trim()) {
    warn("summary is empty; say in one or two sentences what the change does");
  }

  const lines = new Map<string, string[] | undefined>();
  const linesOf = (file: string) => {
    if (!lines.has(file)) {
      const text = readFile(file);
      lines.set(file, text === undefined ? undefined : text.replace(/\r\n?/g, "\n").split("\n"));
    }
    return lines.get(file);
  };

  tour.steps.forEach((step, i) => {
    const fileLines = linesOf(step.file);
    if (!fileLines) {
      error(`file "${step.file}" does not exist (paths are relative to the workspace root)`, i);
      return;
    }
    const { start, end } = step.range;
    if (end > fileLines.length) {
      error(`range ends at line ${end}, but ${step.file} has ${fileLines.length} lines`, i);
    }
    lintAnchor(step, fileLines, i, error, warn);

    const size = end - start + 1;
    if (size > TARGET_MAX_LINES) {
      warn(`step covers ${size} lines; aim for at most ${TARGET_MAX_LINES}. Split it or narrow it to the key lines`, i);
    }
    lintDescription(step, i, warn);
  });

  lintOverlaps(tour, error);
  return messages;
}

function lintAnchor(
  step: TourStep,
  fileLines: string[],
  i: number,
  error: (m: string, s?: number) => void,
  warn: (m: string, s?: number) => void,
): void {
  const anchor = step.anchor.trim();
  const startLine = fileLines[step.range.start - 1];
  if (startLine !== undefined && startLine.includes(anchor)) {
    const { min, max } = TARGET_ANCHOR_LENGTH;
    if (anchor.length < min) {
      warn(`anchor "${anchor}" is ${anchor.length} characters; copy a longer, distinctive part of line ${step.range.start} (${min}–${max})`, i);
    } else if (anchor.length > max) {
      warn(`anchor is ${anchor.length} characters; use a shorter distinctive fragment (${min}–${max}) so small edits do not break it`, i);
    }
    return;
  }
  // Tell the agent exactly how to fix it: where the anchor really is, if anywhere.
  const found = fileLines.flatMap((text, n) => (text.includes(anchor) ? [n + 1] : []));
  const shown = startLine === undefined ? "(past end of file)" : JSON.stringify(startLine.trim().slice(0, 80));
  if (found.length === 0) {
    error(
      `anchor ${JSON.stringify(anchor)} does not appear in ${step.file}. Copy it exactly from line ${step.range.start}, which is ${shown}`,
      i,
    );
    return;
  }
  const nearest = found.reduce((a, b) => (Math.abs(b - step.range.start) < Math.abs(a - step.range.start) ? b : a));
  const length = step.range.end - step.range.start;
  error(
    `anchor is not on line ${step.range.start} (${shown}) but on line ${nearest}. ` +
      `If that is the intended code, set range to { start: ${nearest}, end: ${nearest + length} }`,
    i,
  );
}

function lintDescription(step: TourStep, i: number, warn: (m: string, s?: number) => void): void {
  const text = step.description;
  if (!text.trim()) {
    warn("description is empty", i);
    return;
  }
  if (text.length > MAX_DESCRIPTION_CHARS) {
    warn(`description is ${text.length} characters; keep it under ${MAX_DESCRIPTION_CHARS} (about 150 words) so the card stays readable`, i);
  }
  if (!/\*\*What:\*\*/.test(text)) {
    warn('description has no "**What:**" section', i);
  }
  if (step.kind === "decision" && !/\*\*Why:\*\*/.test(text)) {
    warn('decision step has no "**Why:**" section explaining the choice', i);
  }
  if (step.kind === "risk" && !/\*\*Watch for:\*\*/.test(text)) {
    warn('risk step has no "**Watch for:**" section', i);
  }
}

function lintOverlaps(tour: Tour, error: (m: string, s?: number) => void): void {
  const byFile = new Map<string, number[]>();
  tour.steps.forEach((step, i) => {
    const key = step.file.replace(/\\/g, "/");
    byFile.set(key, [...(byFile.get(key) ?? []), i]);
  });
  for (const indexes of byFile.values()) {
    const sorted = [...indexes].sort((a, b) => tour.steps[a].range.start - tour.steps[b].range.start);
    for (let k = 1; k < sorted.length; k++) {
      const prev = tour.steps[sorted[k - 1]];
      const cur = tour.steps[sorted[k]];
      if (cur.range.start <= prev.range.end) {
        error(
          `lines ${cur.range.start}-${cur.range.end} overlap step ${sorted[k - 1] + 1} ` +
            `(lines ${prev.range.start}-${prev.range.end}) in ${cur.file}; merge them or split the range`,
          sorted[k],
        );
      }
    }
  }
}
