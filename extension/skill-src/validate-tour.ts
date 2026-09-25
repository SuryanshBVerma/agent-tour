/**
 * Validator and publisher the code-tour skill tells agents to run. Tours live outside the
 * repository, in a per-user temp folder with one slot per workspace (see tourLocation.ts):
 *
 *   node validate-tour.mjs --where [--root <workspace>]
 *       Print the draft path to write and the slot the extension watches.
 *   node validate-tour.mjs <draft.json> [--root <workspace>]
 *       Validate only.
 *   node validate-tour.mjs <draft.json> --publish [--root <workspace>]
 *       Validate, then (only if valid) atomically replace the workspace's current tour.
 *
 * <workspace> defaults to the current directory and must be the folder open in VS Code
 * (normally the git top level). Bundled into skill/code-tour/scripts/validate-tour.mjs by
 * `npm run build:skill`; runs with plain node >= 18. Same schema and rules as the extension.
 * Exit codes: 0 valid (warnings allowed), 1 invalid, 2 usage or I/O error.
 */
import * as fs from "fs";
import * as path from "path";
import { isSafeRelativePath, relativeLeavesRoot } from "../src/pathRules";
import { LintMessage, lintTour } from "../src/tourLint";
import {
  ensureTourRoot,
  tourDraftPath,
  tourRootProblem,
  tourSlotPath,
  writeTourAtomically,
} from "../src/tourLocation";
import { validateTour } from "../src/tourValidation";

const USAGE = [
  "usage: node validate-tour.mjs --where [--root <workspace>]",
  "       node validate-tour.mjs <draft.json> [--publish] [--root <workspace>]",
].join("\n");

interface Args {
  tourPath?: string;
  root?: string;
  where: boolean;
  publish: boolean;
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (!args || (!args.where && !args.tourPath) || (args.where && (args.tourPath || args.publish))) {
    console.error(USAGE);
    return 2;
  }
  const root = path.resolve(args.root ?? process.cwd());

  if (args.where) {
    const problem = tourRootProblem();
    if (problem) {
      console.error(`refusing to use the tour folder: ${problem}`);
      return 2;
    }
    ensureTourRoot();
    console.log(`draft: ${tourDraftPath(root)}`);
    console.log(`slot:  ${tourSlotPath(root)}`);
    return 0;
  }

  const tourPath = path.resolve(args.tourPath!);
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

  const result = validateTour(data);
  if (!result.ok) {
    report(result.errors.map((message) => ({ severity: "error" as const, message })), undefined);
    return 1;
  }

  const messages = lintTour(result.tour, (relative) => readWorkspaceFile(root, relative));
  if (isInside(root, tourPath)) {
    messages.unshift({
      severity: "warning",
      message: "the draft is inside the workspace; write it to the draft path from --where so it is not committed",
    });
  }
  report(messages, result.tour);
  if (messages.some((m) => m.severity === "error")) {
    return 1;
  }

  if (args.publish) {
    const problem = tourRootProblem();
    if (problem) {
      console.error(`refusing to publish: ${problem}`);
      return 2;
    }
    ensureTourRoot();
    const slot = tourSlotPath(root);
    writeTourAtomically(slot, `${JSON.stringify(result.tour, null, 2)}\n`);
    if (path.resolve(tourPath) === path.resolve(tourDraftPath(root))) {
      fs.rmSync(tourPath, { force: true });
    }
    console.log(`PUBLISHED: ${slot} (replaces this workspace's previous tour)`);
  }
  return 0;
}

function parseArgs(argv: string[]): Args | undefined {
  const args: Args = { where: false, publish: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") {
      args.root = argv[++i];
      if (!args.root) {
        return undefined;
      }
    } else if (arg === "--where") {
      args.where = true;
    } else if (arg === "--publish") {
      args.publish = true;
    } else if (!args.tourPath && !arg.startsWith("-")) {
      args.tourPath = arg;
    } else {
      return undefined;
    }
  }
  return args;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !relativeLeavesRoot(relative) && !path.isAbsolute(relative);
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
