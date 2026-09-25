/**
 * Validator the code-tour skill tells agents to run after writing a tour:
 *
 *   node <skill>/scripts/validate-tour.mjs .agent-tours/<id>.json [--root <workspace>]
 *
 * Bundled with its dependencies into skill/code-tour/scripts/validate-tour.mjs by
 * `npm run build:skill`, so it runs in any repository with plain node >= 18.
 * Uses the same schema and rules as the extension, plus file-level lint checks.
 * Exit codes: 0 valid (warnings allowed), 1 invalid, 2 usage or I/O error.
 */
import * as fs from "fs";
import * as path from "path";
import { isSafeRelativePath, relativeLeavesRoot } from "../src/pathRules";
import { LintMessage, lintTour } from "../src/tourLint";
import { validateTour } from "../src/tourValidation";

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (!args) {
    console.error("usage: node validate-tour.mjs <path/to/.agent-tours/<id>.json> [--root <workspace root>]");
    return 2;
  }
  const tourPath = path.resolve(args.tourPath);
  const root = path.resolve(args.root ?? process.cwd());

  let text: string;
  try {
    text = fs.readFileSync(tourPath, "utf8");
  } catch (error) {
    console.error(`cannot read ${tourPath}: ${(error as Error).message}`);
    return 2;
  }

  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    report([{ severity: "error", message: `not valid JSON: ${(error as Error).message}` }], undefined);
    return 1;
  }

  const fileId = path.basename(tourPath, ".json");
  const result = validateTour(data, fileId);
  if (!result.ok) {
    report(result.errors.map((message) => ({ severity: "error" as const, message })), undefined);
    return 1;
  }

  const messages = lintTour(result.tour, (relative) => readWorkspaceFile(root, relative));
  if (path.basename(path.dirname(tourPath)) !== ".agent-tours") {
    messages.unshift({
      severity: "warning",
      message: "tour is not in a folder named .agent-tours; the extension only finds it there unless agentTour.tourDirectory is changed",
    });
  }
  report(messages, result.tour);
  return messages.some((m) => m.severity === "error") ? 1 : 0;
}

function parseArgs(argv: string[]): { tourPath: string; root?: string } | undefined {
  let tourPath: string | undefined;
  let root: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      root = argv[++i];
      if (!root) {
        return undefined;
      }
    } else if (!tourPath && !argv[i].startsWith("-")) {
      tourPath = argv[i];
    } else {
      return undefined;
    }
  }
  return tourPath ? { tourPath, root } : undefined;
}

/**
 * Reads a tour-referenced file, refusing anything that resolves outside the root,
 * including through symlinks (both sides are compared after realpath).
 */
function readWorkspaceFile(root: string, relative: string): string | undefined {
  if (!isSafeRelativePath(relative)) {
    return undefined;
  }
  try {
    const realRoot = fs.realpathSync(root);
    const full = fs.realpathSync(path.resolve(root, relative));
    const inside = path.relative(realRoot, full);
    if (relativeLeavesRoot(inside) || path.isAbsolute(inside)) {
      return undefined;
    }
    return fs.statSync(full).isFile() ? fs.readFileSync(full, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

function report(messages: LintMessage[], tour: { steps: { file: string; range: { start: number; end: number } }[] } | undefined): void {
  for (const m of messages) {
    const step = m.step !== undefined && tour ? tour.steps[m.step] : undefined;
    const where = step ? `step ${m.step! + 1} (${step.file}:${step.range.start}-${step.range.end}): ` : "";
    const label = m.severity === "error" ? "ERROR" : "WARN ";
    console.log(`${label} ${where}${m.message}`);
  }
  const errors = messages.filter((m) => m.severity === "error").length;
  const warnings = messages.length - errors;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (errors > 0) {
    console.log(`INVALID: ${plural(errors, "error")}, ${plural(warnings, "warning")}. Fix the errors and run the validator again.`);
  } else {
    const steps = tour ? `${plural(tour.steps.length, "step")}, ` : "";
    console.log(`VALID: ${steps}${plural(warnings, "warning")}.`);
  }
}

process.exitCode = main(process.argv.slice(2));
