import * as vscode from "vscode";
import { TourPlayer } from "./tourPlayer";
import { LoadedTour, TourChange, TourStore } from "./tourStore";
import { TOUR_ID_PATTERN } from "./types";

export type AutoStartMode = "off" | "prompt" | "on";

/** With autoStart "on", wait until the user has not typed or clicked for this long. */
const QUIET_MS = 3000;
/** Give up waiting for a quiet moment after this long and ask instead. */
const MAX_QUIET_WAIT_MS = 30000;

/**
 * Starts tours from two sources: new or changed tour files (per `agentTour.autoStart`)
 * and `vscode://trivium.agent-tour/start?id=<id>` links. Only a regex-validated id is
 * read from a URI; paths and content never are. Nothing auto-starts in an untrusted
 * workspace.
 */
export class TriggerHandler implements vscode.UriHandler, vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly openPrompts = new Set<string>();
  private lastUserInput = 0;

  constructor(
    private readonly store: TourStore,
    private readonly player: TourPlayer,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.subscriptions.push(
      vscode.window.registerUriHandler(this),
      store.onDidChange((change) => void this.onTourChange(change)),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (
          event.kind === vscode.TextEditorSelectionChangeKind.Keyboard ||
          event.kind === vscode.TextEditorSelectionChangeKind.Mouse
        ) {
          this.lastUserInput = Date.now();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        // Typing makes the document dirty; a reload from disk (e.g. an agent's write) does not.
        if (event.contentChanges.length > 0 && event.document.isDirty &&
            event.document === vscode.window.activeTextEditor?.document) {
          this.lastUserInput = Date.now();
        }
      }),
    );
  }

  async handleUri(uri: vscode.Uri): Promise<void> {
    // Logged with a timestamp so delivery latency of `code --open-url` can be measured.
    this.log.info(`URI received at ${new Date().toISOString()}: path=${uri.path}`);
    const id = parseStartUri(uri);
    if (id === undefined) {
      this.log.warn("Ignored URI: not /start, or missing or invalid tour id");
      void vscode.window.showWarningMessage("Agent Tour: ignored an invalid start link.");
      return;
    }
    if (!vscode.workspace.isTrusted) {
      this.log.warn(`Refused to start tour "${id}" in an untrusted workspace`);
      void vscode.window.showWarningMessage("Agent Tour: tours cannot be started from links in an untrusted workspace.");
      return;
    }
    const found = await this.store.find(id);
    if (!found) {
      void vscode.window.showWarningMessage(`Agent Tour: no tour with id "${id}".`);
    } else if ("errors" in found) {
      showInvalid(found.folder, this.log);
    } else {
      await this.player.start(found.tour, found.folder);
    }
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private async onTourChange(change: TourChange): Promise<void> {
    const playing = this.player.snapshot();
    if (change.type === "removed") {
      if (playing.status === "playing" && playing.tourId === change.id) {
        await this.player.stop();
        void vscode.window.showInformationMessage(`Agent Tour: the tour file for "${change.id}" was deleted.`);
      }
      return;
    }
    if (!change.fromWatcher) {
      return;
    }
    if (change.type === "invalid") {
      if (autoStartMode() !== "off") {
        showInvalid(change.invalid.folder, this.log);
      }
      return;
    }

    const { loaded } = change;
    if (playing.status === "playing" && playing.tourId === loaded.tour.id) {
      await this.player.update(loaded.tour);
      return;
    }
    const mode = autoStartMode();
    if (mode === "off") {
      return;
    }
    if (!vscode.workspace.isTrusted) {
      this.log.info(`Not auto-starting "${loaded.tour.id}": workspace is untrusted`);
      return;
    }
    // Never replace a running tour without asking.
    if (mode === "on" && playing.status !== "playing" && (await this.waitForQuiet())) {
      this.log.info(`Auto-starting "${loaded.tour.id}"`);
      await this.player.start(loaded.tour, loaded.folder);
      return;
    }
    await this.prompt(loaded);
  }

  private async prompt(loaded: LoadedTour): Promise<void> {
    const { tour } = loaded;
    if (this.openPrompts.has(tour.id)) {
      return;
    }
    this.openPrompts.add(tour.id);
    try {
      const choice = await vscode.window.showInformationMessage(
        `Agent tour ready: ${tour.title} (${tour.steps.length} steps)`,
        "Start Tour",
      );
      if (choice === "Start Tour") {
        // Re-read so a file rewritten while the prompt was open is not played stale.
        const latest = this.store.get(tour.id) ?? loaded;
        await this.player.start(latest.tour, latest.folder);
      }
    } finally {
      this.openPrompts.delete(tour.id);
    }
  }

  /** Resolves true once the user has been idle for QUIET_MS, false after MAX_QUIET_WAIT_MS. */
  private async waitForQuiet(): Promise<boolean> {
    const deadline = Date.now() + MAX_QUIET_WAIT_MS;
    while (Date.now() - this.lastUserInput < QUIET_MS) {
      if (Date.now() >= deadline) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return true;
  }
}

/** Returns the tour id from a `/start?id=<id>` URI, or undefined if the URI is invalid. */
export function parseStartUri(uri: vscode.Uri): string | undefined {
  if (uri.path !== "/start") {
    return undefined;
  }
  const ids = new URLSearchParams(uri.query).getAll("id");
  if (ids.length !== 1 || !TOUR_ID_PATTERN.test(ids[0])) {
    return undefined;
  }
  return ids[0];
}

function autoStartMode(): AutoStartMode {
  return vscode.workspace.getConfiguration("agentTour").get<AutoStartMode>("autoStart", "prompt");
}

function showInvalid(folder: vscode.Uri, log: vscode.LogOutputChannel): void {
  const name = vscode.workspace.getWorkspaceFolder(folder)?.name ?? folder.fsPath;
  void vscode.window
    .showWarningMessage(`Agent Tour: the latest tour for ${name} is not valid.`, "Show Errors")
    .then((choice) => {
      if (choice === "Show Errors") {
        log.show(true);
      }
    });
}
