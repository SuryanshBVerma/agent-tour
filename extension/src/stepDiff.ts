import * as path from "path";
import * as vscode from "vscode";
import { BaseResolver, sameFilePath } from "./gitService";
import type { Tour } from "./types";

/** Either the editor showing the modified side of the diff, or why there is none. */
export type StepDiff = { editor: vscode.TextEditor } | { fallback: string };

/** How long to wait for the diff's modified editor to appear (VS Code opens it asynchronously). */
const EDITOR_APPEAR_ATTEMPTS = 10;
const EDITOR_APPEAR_DELAY_MS = 20;

/**
 * Opens the native diff editor for a step: the file at the tour's base ref on the left, the
 * working file on the right. `vscode.diff` returns nothing, so the modified editor is located
 * afterwards. The layout follows the user's `diffEditor.renderSideBySide` setting.
 */
export async function openStepDiff(
  resolver: BaseResolver,
  folder: vscode.Uri,
  workingUri: vscode.Uri,
  tour: Tour,
  index: number,
): Promise<StepDiff> {
  const step = tour.steps[index];
  const base = await resolver.resolveBase(folder, step.file, tour.baseRef);
  if (base.kind !== "ok") {
    return { fallback: base.kind === "added" ? `${step.file} has no version at ${tour.baseRef}` : base.reason };
  }
  try {
    // Resolve the base content first: a git: URI that cannot be read would otherwise open a
    // diff with an error on the left instead of falling back cleanly.
    await vscode.workspace.openTextDocument(base.left);
    await vscode.commands.executeCommand("vscode.diff", base.left, workingUri, diffTitle(tour, index), {
      preview: false,
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.Active,
    });
  } catch (error) {
    return { fallback: `the base version could not be read (${String(error)})` };
  }
  const editor = await findModifiedEditor(workingUri);
  return editor ? { editor } : { fallback: "the diff editor did not open" };
}

function diffTitle(tour: Tour, index: number): string {
  const step = tour.steps[index];
  return `${path.posix.basename(step.file)} · step ${index + 1} · ${tour.baseRef} vs working`;
}

/** The active editor when it shows the working file, else any visible editor for it. */
async function findModifiedEditor(uri: vscode.Uri): Promise<vscode.TextEditor | undefined> {
  for (let attempt = 0; attempt < EDITOR_APPEAR_ATTEMPTS; attempt++) {
    const active = vscode.window.activeTextEditor;
    if (active && sameFilePath(active.document.uri, uri)) {
      return active;
    }
    const visible = vscode.window.visibleTextEditors.find((editor) => sameFilePath(editor.document.uri, uri));
    if (visible) {
      return visible;
    }
    await new Promise((resolve) => setTimeout(resolve, EDITOR_APPEAR_DELAY_MS));
  }
  return undefined;
}
