import * as vscode from "vscode";
import { formatDelta, resolveStep } from "./anchorResolver";
import { ControlBar } from "./controlBar";
import { isInsideAfterSymlinks, resolveWorkspaceFile } from "./paths";
import { DimMode, SpotlightOptions, SpotlightRenderer } from "./spotlightRenderer";
import { StepCard, renderCard } from "./stepCard";
import { StepStatus, Tour } from "./types";

export type PlayerState =
  | { status: "idle" }
  | { status: "playing"; tour: Tour; folder: vscode.Uri; index: number }
  | { status: "ended"; tour: Tour };

/** Snapshot for tests, the tour tree and diagnostics. */
export interface PlayerSnapshot {
  status: PlayerState["status"];
  tourId?: string;
  index?: number;
  total?: number;
  /** How the current step mapped onto the file as it is now. */
  stepStatus?: StepStatus;
  /** 0-based line the current step starts on after anchor resolution. */
  startLine?: number;
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
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Incremented per navigation so a slow `goto` never renders over a newer one. */
  private navigation = 0;
  /** Resolution result of each step visited in the current tour, by index. */
  private statuses = new Map<number, StepStatus>();
  private startLine: number | undefined;

  /** Fires when the tour, step or step status changes. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.renderer = new SpotlightRenderer(readSpotlightOptions());
    this.card = new StepCard(log);
    this.subscriptions.push(
      this.changeEmitter,
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
          stepStatus: this.statuses.get(this.state.index),
          startLine: this.startLine,
        };
    }
  }

  /** Status of a visited step of the playing tour; undefined if not visited or not playing. */
  stepStatus(tourId: string, index: number): StepStatus | undefined {
    return this.state.status === "playing" && this.state.tour.id === tourId ? this.statuses.get(index) : undefined;
  }

  async start(tour: Tour, folder: vscode.Uri, index = 0): Promise<void> {
    if (tour.steps.length === 0) {
      void vscode.window.showWarningMessage(`Tour "${tour.title}" has no steps.`);
      return;
    }
    this.log.info(`Starting tour "${tour.id}" (${tour.steps.length} steps) in ${folder.fsPath}`);
    this.statuses = new Map();
    this.state = { status: "playing", tour, folder, index: 0 };
    // goto must claim its navigation token synchronously: awaiting anything first would
    // let a navigation made in between (tree click, keybinding) be overwritten by step 1.
    void vscode.commands.executeCommand("setContext", "agentTour.active", true);
    await this.goto(Math.min(Math.max(index, 0), tour.steps.length - 1));
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
    this.statuses = new Map();
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
      this.changeEmitter.fire();
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
    this.statuses = new Map();
    this.startLine = undefined;
    this.renderer.clear();
    this.card.clear();
    this.controlBar.hide();
    this.changeEmitter.fire();
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
    const confined = uri !== undefined && (await isInsideAfterSymlinks(folder, uri));
    const document = uri && confined ? await openDocument(uri) : undefined;
    if (navigation !== this.navigation) {
      return;
    }
    if (!uri || !document) {
      // Keep the tour navigable, but never leave the previous step's highlight on screen.
      this.log.error(`Step ${index + 1}: cannot open "${step.file}" (missing, or it resolves outside the workspace)`);
      this.statuses.set(index, "missing");
      this.startLine = undefined;
      this.renderer.clear();
      this.card.clear();
      this.controlBar.update(tour, index, "missing");
      this.changeEmitter.fire();
      await hideHover(this.log);
      void vscode.window.showWarningMessage(
        `Agent Tour: step ${index + 1} refers to ${step.file}, which cannot be opened (it is missing, or it resolves outside the workspace). Use Next or Previous to continue.`,
      );
      return;
    }

    const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
    if (navigation !== this.navigation) {
      return;
    }

    const resolution = resolveStep(document, step);
    this.statuses.set(index, resolution.status);
    this.startLine = resolution.range.start.line;
    if (resolution.status === "relocated") {
      this.log.info(`Step ${index + 1}: anchor moved ${formatDelta(resolution.delta)} to line ${this.startLine + 1}`);
    } else if (resolution.status === "stale") {
      this.log.warn(`Step ${index + 1}: anchor "${step.anchor}" not found in ${step.file}`);
    }

    const { range } = resolution;
    this.renderer.show(editor, range, step.kind, index + 1, resolution.status === "stale");
    this.card.set(uri, range, renderCard(tour, index, resolution));
    this.controlBar.update(tour, index, resolution.status);
    this.changeEmitter.fire();

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
    this.log.info(`Step ${index + 1}/${tour.steps.length}: ${step.file}:${range.start.line + 1}-${range.end.line + 1}`);
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

async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
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
