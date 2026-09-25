import * as vscode from "vscode";
import { TourPlayer } from "./tourPlayer";
import { TourStore } from "./tourStore";
import { TourNode, TourTree } from "./tourTree";
import { TriggerHandler } from "./triggerHandler";
import { KIND_LABELS, TOUR_ID_PATTERN } from "./types";

export interface AgentTourApi {
  player: TourPlayer;
  store: TourStore;
  trigger: TriggerHandler;
  tree: TourTree;
}

export async function activate(context: vscode.ExtensionContext): Promise<AgentTourApi> {
  const log = vscode.window.createOutputChannel("Agent Tour", { log: true });
  const store = new TourStore(log);
  const player = new TourPlayer(log);
  const trigger = new TriggerHandler(store, player, log);
  const tree = new TourTree(store, player);

  context.subscriptions.push(
    log,
    store,
    player,
    trigger,
    tree,
    vscode.commands.registerCommand("agentTour.start", (arg?: unknown) => startTour(store, player, arg)),
    vscode.commands.registerCommand("agentTour.goto", (id: unknown, index: unknown) =>
      startTour(store, player, id, typeof index === "number" ? index : 0),
    ),
    vscode.commands.registerCommand("agentTour.reload", () => store.reload()),
    vscode.commands.registerCommand("agentTour.next", () => player.next()),
    vscode.commands.registerCommand("agentTour.previous", () => player.previous()),
    vscode.commands.registerCommand("agentTour.showCard", () => player.showCard()),
    vscode.commands.registerCommand("agentTour.stop", () => player.stop()),
  );
  void vscode.commands.executeCommand("setContext", "agentTour.active", false);
  await store.reload();
  log.info(`Activated (VS Code ${vscode.version})`);

  return { player, store, trigger, tree };
}

/**
 * Starts a tour, or jumps within it if it is already playing. `arg` is a tour id (from
 * another command or a keybinding), a tree node (inline Start action), or absent (quick pick).
 */
async function startTour(store: TourStore, player: TourPlayer, arg: unknown, index = 0): Promise<void> {
  const id = isTourNode(arg) ? arg.loaded.tour.id : arg;
  if (typeof id === "string") {
    const playing = player.snapshot();
    if (playing.status === "playing" && playing.tourId === id) {
      await player.goto(Math.min(Math.max(index, 0), (playing.total ?? 1) - 1));
      return;
    }
    const found = TOUR_ID_PATTERN.test(id) ? await store.find(id) : undefined;
    if (!found || "errors" in found) {
      void vscode.window.showWarningMessage(`Agent Tour: no valid tour with id "${id}".`);
      return;
    }
    await player.start(found.tour, found.folder, index);
    return;
  }

  const tours = store.all();
  const invalidCount = store.invalidTours().length;
  if (tours.length === 0) {
    const detail = invalidCount > 0 ? ` ${invalidCount} tour file(s) are invalid; see Output → Agent Tour.` : "";
    void vscode.window.showInformationMessage(`Agent Tour: no tours found.${detail}`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    tours.map((loaded) => ({
      label: loaded.tour.title,
      description: `${loaded.tour.steps.length} steps · ${loaded.tour.id}`,
      detail: loaded.tour.summary || summarizeKinds(loaded.tour.steps.map((s) => s.kind)),
      loaded,
    })),
    { placeHolder: "Select a tour to start", matchOnDescription: true },
  );
  if (picked) {
    await player.start(picked.loaded.tour, picked.loaded.folder);
  }
}

function isTourNode(arg: unknown): arg is TourNode & { type: "tour" } {
  return typeof arg === "object" && arg !== null && (arg as TourNode).type === "tour";
}

function summarizeKinds(kinds: (keyof typeof KIND_LABELS)[]): string {
  const counts = new Map<string, number>();
  for (const kind of kinds) {
    counts.set(KIND_LABELS[kind], (counts.get(KIND_LABELS[kind]) ?? 0) + 1);
  }
  return [...counts].map(([label, n]) => `${n} ${label}`).join(", ");
}

export function deactivate(): void {}
