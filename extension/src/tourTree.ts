import * as path from "path";
import * as vscode from "vscode";
import { sanitizeDescription } from "./stepCard";
import { TourPlayer } from "./tourPlayer";
import { InvalidTour, LoadedTour, TourStore } from "./tourStore";
import { KIND_LABELS, StepKind } from "./types";

export type TourNode =
  | { type: "tour"; loaded: LoadedTour }
  | { type: "step"; loaded: LoadedTour; index: number }
  | { type: "invalid"; invalid: InvalidTour };

const KIND_ICONS: Record<StepKind, string> = {
  change: "diff-modified",
  context: "info",
  risk: "warning",
  decision: "law",
};

/**
 * Sidebar list of tours and their steps. Clicking a step starts the tour there (or
 * jumps, if it is already playing). Invalid tour files are listed with their errors.
 * All tour text is shown as plain text or untrusted Markdown; nothing here can run
 * commands except the item actions this class sets.
 */
export class TourTree implements vscode.TreeDataProvider<TourNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<TourNode | undefined>();
  private readonly view: vscode.TreeView<TourNode>;
  private readonly subscriptions: vscode.Disposable[] = [];

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly store: TourStore,
    private readonly player: TourPlayer,
  ) {
    this.view = vscode.window.createTreeView("agentTour.tours", { treeDataProvider: this, showCollapseAll: true });
    this.subscriptions.push(
      this.changeEmitter,
      this.view,
      store.onDidChange(() => this.changeEmitter.fire(undefined)),
      player.onDidChange(() => {
        this.changeEmitter.fire(undefined);
        void this.revealCurrent();
      }),
    );
  }

  getChildren(node?: TourNode): TourNode[] {
    if (!node) {
      return [
        ...this.store.all().map((loaded): TourNode => ({ type: "tour", loaded })),
        ...this.store.invalidTours().map((invalid): TourNode => ({ type: "invalid", invalid })),
      ];
    }
    if (node.type === "tour") {
      return node.loaded.tour.steps.map((_, index): TourNode => ({ type: "step", loaded: node.loaded, index }));
    }
    return [];
  }

  getParent(node: TourNode): TourNode | undefined {
    return node.type === "step" ? { type: "tour", loaded: node.loaded } : undefined;
  }

  getTreeItem(node: TourNode): vscode.TreeItem {
    switch (node.type) {
      case "tour":
        return this.tourItem(node.loaded);
      case "step":
        return this.stepItem(node.loaded, node.index);
      case "invalid":
        return invalidItem(node.invalid);
    }
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private tourItem(loaded: LoadedTour): vscode.TreeItem {
    const { tour } = loaded;
    const playing = this.isPlaying(tour.id);
    const item = new vscode.TreeItem(
      tour.title,
      playing ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = `tour:${tour.id}`;
    item.description = `${tour.steps.length} steps${playing ? " · playing" : ""}`;
    item.iconPath = new vscode.ThemeIcon(playing ? "play-circle" : "map");
    item.contextValue = "agentTour.tour";
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText(tour.summary || tour.title);
    tooltip.appendMarkdown("\n\n---\n\n");
    tooltip.appendText(`id: ${tour.id}\nbase: ${tour.baseRef}\nby: ${tour.createdBy}`);
    item.tooltip = tooltip;
    return item;
  }

  private stepItem(loaded: LoadedTour, index: number): vscode.TreeItem {
    const { tour } = loaded;
    const step = tour.steps[index];
    const current = this.isPlaying(tour.id) && this.player.snapshot().index === index;
    const status = this.player.stepStatus(tour.id, index);

    const item = new vscode.TreeItem(`${index + 1}. ${step.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = `step:${tour.id}:${index}`;
    const problem = status === "stale" ? " · stale" : status === "missing" ? " · file missing" : "";
    item.description = `${path.posix.basename(step.file)}:${step.range.start}${problem}`;
    item.iconPath = current
      ? new vscode.ThemeIcon("arrow-right", new vscode.ThemeColor(`agentTour.${step.kind}Border`))
      : problem
        ? new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"))
        : new vscode.ThemeIcon(KIND_ICONS[step.kind], new vscode.ThemeColor(`agentTour.${step.kind}Border`));
    item.contextValue = "agentTour.step";
    item.command = { command: "agentTour.goto", title: "Go to Step", arguments: [tour.id, index] };

    // Untrusted Markdown: no commands, no HTML, images neutralized.
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText(`${KIND_LABELS[step.kind]} · ${step.file}:${step.range.start}-${step.range.end}`);
    tooltip.appendMarkdown(`\n\n${sanitizeDescription(step.description)}`);
    item.tooltip = tooltip;
    return item;
  }

  private isPlaying(tourId: string): boolean {
    const snapshot = this.player.snapshot();
    return snapshot.status === "playing" && snapshot.tourId === tourId;
  }

  /** Keeps the current step selected in the tree while it is visible. */
  private async revealCurrent(): Promise<void> {
    const snapshot = this.player.snapshot();
    if (!this.view.visible || snapshot.status !== "playing" || !snapshot.tourId || snapshot.index === undefined) {
      return;
    }
    const loaded = this.store.get(snapshot.tourId);
    if (loaded) {
      try {
        await this.view.reveal({ type: "step", loaded, index: snapshot.index }, { select: true, focus: false });
      } catch {
        // The tree may be refreshing; the next change reveals again.
      }
    }
  }
}

function invalidItem(invalid: InvalidTour): vscode.TreeItem {
  const item = new vscode.TreeItem(path.posix.basename(invalid.uri.path), vscode.TreeItemCollapsibleState.None);
  item.id = `invalid:${invalid.uri.toString()}`;
  item.description = "invalid";
  item.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("list.errorForeground"));
  item.contextValue = "agentTour.invalid";
  const tooltip = new vscode.MarkdownString();
  tooltip.appendText(invalid.errors.join("\n"));
  item.tooltip = tooltip;
  item.command = { command: "vscode.open", title: "Open Tour File", arguments: [invalid.uri] };
  return item;
}
