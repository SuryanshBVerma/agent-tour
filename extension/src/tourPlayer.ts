import * as vscode from "vscode";
import { ControlBar } from "./controlBar";
import { resolveWorkspaceFile } from "./paths";
import { DimMode, SpotlightOptions, SpotlightRenderer } from "./spotlightRenderer";
import { StepCard, renderCard } from "./stepCard";
import { Tour } from "./types";

export type PlayerState =
  | { status: "idle" }
  | { status: "playing"; tour: Tour; folder: vscode.Uri; index: number }
  | { status: "ended"; tour: Tour };

/** Snapshot for tests and diagnostics. */
export interface PlayerSnapshot {
  status: PlayerState["status"];
  tourId?: string;
  index?: number;
  total?: number;
  /** Whether the current step's anchor was found at its declared start line. */
  anchorMatched?: boolean;
  /** Decorated range count per visible document path; empty after cleanup. */
  decorated: Record<string, number>;
}

/** Delay before showing the card so the editor has finished revealing the range. */
const HOVER_DELAY_MS = 150;

/** State machine: idle → playing(i) → ended. Owns the renderer, card and control bar. */
export class TourPlayer implements vscode.Disposable {
  private state: PlayerState = { status: "idle" };
  private readonly renderer: SpotlightRenderer;
  private readonly card: StepCard;
  private readonly controlBar = new ControlBar();
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Incremented per navigation so a slow `goto` never renders over a newer one. */
  private navigation = 0;
  private anchorMatched: boolean | undefined;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.renderer = new SpotlightRenderer(readSpotlightOptions());
    this.card = new StepCard(log);
    this.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.renderer.redrawVisible()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("agentTour.dimMode") || event.affectsConfiguration("agentTour.dimOpacity")) {
          this.renderer.configure(readSpotlightOptions());
        }
      }),
    );
  }

  snapshot(): PlayerSnapshot {
    const decorated = Object.fromEntries(this.renderer.appliedRanges());
    switch (this.state.status) {
      case "idle":
        return { status: "idle", decorated };
      case "ended":
        return { status: "ended", tourId: this.state.tour.id, decorated };
      case "playing":
        return {
          decorated,
          status: "playing",
          tourId: this.state.tour.id,
          index: this.state.index,
          total: this.state.tour.steps.length,
          anchorMatched: this.anchorMatched,
        };
    }
  }

  async start(tour: Tour, folder: vscode.Uri): Promise<void> {
    if (tour.steps.length === 0) {
      void vscode.window.showWarningMessage(`Tour "${tour.title}" has no steps.`);
      return;
    }
    this.log.info(`Starting tour "${tour.id}" (${tour.steps.length} steps) in ${folder.fsPath}`);
    this.state = { status: "playing", tour, folder, index: 0 };
    await vscode.commands.executeCommand("setContext", "agentTour.active", true);
    await this.goto(0);
  }

  /**
   * Swaps in a rewritten version of the tour that is playing (e.g. the agent fixed it)
   * and redraws the current step, clamped to the new step count.
   */
  async update(tour: Tour): Promise<void> {
    if (this.state.status !== "playing" || this.state.tour.id !== tour.id) {
      return;
    }
    this.log.info(`Tour "${tour.id}" changed on disk; reloading`);
    const index = Math.min(this.state.index, tour.steps.length - 1);
    this.state = { ...this.state, tour, index };
    await this.goto(index, { reveal: false });
  }

  async next(): Promise<void> {
    if (this.state.status !== "playing") {
      return;
    }
    if (this.state.index >= this.state.tour.steps.length - 1) {
      const tour = this.state.tour;
      await this.stop();
      this.state = { status: "ended", tour };
      void vscode.window.showInformationMessage(`Tour complete: ${tour.title}`);
      return;
    }
    await this.goto(this.state.index + 1);
  }

  async previous(): Promise<void> {
    if (this.state.status === "playing" && this.state.index > 0) {
      await this.goto(this.state.index - 1);
    }
  }

  async showCard(): Promise<void> {
    if (this.state.status === "playing") {
      await this.goto(this.state.index, { reveal: false });
    }
  }

  async stop(): Promise<void> {
    if (this.state.status !== "playing") {
      return;
    }
    this.log.info(`Stopped tour "${this.state.tour.id}" at step ${this.state.index + 1}`);
    this.navigation++;
    this.state = { status: "idle" };
    this.anchorMatched = undefined;
    this.renderer.clear();
    this.card.clear();
    this.controlBar.hide();
    await vscode.commands.executeCommand("setContext", "agentTour.active", false);
    await hideHover(this.log);
  }

  async goto(index: number, { reveal = true } = {}): Promise<void> {
    if (this.state.status !== "playing") {
      return;
    }
    const { tour, folder } = this.state;
    const step = tour.steps[index];
    if (!step) {
      return;
    }
    const navigation = ++this.navigation;
    this.state = { ...this.state, index };

    const uri = resolveWorkspaceFile(folder, step.file);
    if (!uri) {
      this.log.error(`Step ${index + 1}: rejected path "${step.file}" (outside workspace)`);
      void vscode.window.showErrorMessage(`Step ${index + 1} points outside the workspace and was skipped.`);
      return;
    }

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      this.log.error(`Step ${index + 1}: cannot open ${step.file}: ${String(error)}`);
      void vscode.window.showErrorMessage(`Step ${index + 1}: cannot open ${step.file}.`);
      return;
    }
    const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
    if (navigation !== this.navigation) {
      return;
    }

    const range = stepRange(document, step.range.start, step.range.end);
    this.anchorMatched = step.anchor.length > 0 && document.lineAt(range.start.line).text.includes(step.anchor);
    if (!this.anchorMatched) {
      // Phase 2's AnchorResolver relocates the step; for now just flag it.
      this.log.warn(`Step ${index + 1}: anchor "${step.anchor}" not found on line ${range.start.line + 1}`);
    }

    this.renderer.show(editor, range, step.kind, index + 1);
    this.card.set(uri, range, renderCard(tour, index, !this.anchorMatched));
    this.controlBar.update(tour, index);

    const cursor = quietPosition(document.lineAt(range.start.line));
    editor.selection = new vscode.Selection(cursor, cursor);
    if (reveal) {
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }

    await delay(HOVER_DELAY_MS);
    if (navigation !== this.navigation) {
      return;
    }
    await vscode.commands.executeCommand("editor.action.showHover", { focus: "noAutoFocus" });
    this.log.info(`Step ${index + 1}/${tour.steps.length}: ${step.file}:${step.range.start}-${step.range.end}`);
  }

  dispose(): void {
    this.navigation++;
    this.renderer.dispose();
    this.card.dispose();
    this.controlBar.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }
}

function readSpotlightOptions(): SpotlightOptions {
  const config = vscode.workspace.getConfiguration("agentTour");
  return {
    dimMode: config.get<DimMode>("dimMode", "opacity"),
    dimOpacity: config.get<number>("dimOpacity", 0.35),
  };
}

/** Converts a 1-based inclusive range to a clamped, 0-based whole-line range. */
export function stepRange(document: vscode.TextDocument, start: number, end: number): vscode.Range {
  const last = document.lineCount - 1;
  const startLine = Math.min(Math.max(start - 1, 0), last);
  const endLine = Math.min(Math.max(end - 1, startLine), last);
  return new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).range.end.character);
}

/**
 * Picks a cursor position on the line that touches no identifier, so language hovers
 * (types, docs) are less likely to crowd the step card that shares the hover widget.
 */
export function quietPosition(line: vscode.TextLine): vscode.Position {
  const text = line.text;
  const isWord = (ch: string | undefined) => ch !== undefined && /[\w$]/.test(ch);
  if (text.length === 0 || !isWord(text[0])) {
    return new vscode.Position(line.lineNumber, 0);
  }
  for (let i = 1; i <= text.length; i++) {
    if (!isWord(text[i - 1]) && !isWord(text[i])) {
      return new vscode.Position(line.lineNumber, i);
    }
  }
  return new vscode.Position(line.lineNumber, 0);
}

/** Closes an open card. The command id is internal to VS Code, so a failure is only logged. */
async function hideHover(log: vscode.LogOutputChannel): Promise<void> {
  try {
    await vscode.commands.executeCommand("editor.action.hideHover");
  } catch (error) {
    log.debug(`hideHover unavailable: ${String(error)}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
