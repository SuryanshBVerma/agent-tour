import * as vscode from "vscode";
import { resolveWorkspaceFile } from "./paths";
import { SPIKE_TOUR } from "./spikeTour";
import { TourPlayer } from "./tourPlayer";
import { TriggerHandler } from "./triggerHandler";

export interface AgentTourApi {
  player: TourPlayer;
}

export function activate(context: vscode.ExtensionContext): AgentTourApi {
  const log = vscode.window.createOutputChannel("Agent Tour", { log: true });
  const player = new TourPlayer(log);

  // Phase 0: the only known tour is the hardcoded spike tour. TourStore replaces this.
  const startById = async (id: string) => {
    if (id !== SPIKE_TOUR.id) {
      void vscode.window.showWarningMessage(`Agent Tour: no tour with id "${id}".`);
      return;
    }
    await startSpikeTour(player, log);
  };

  context.subscriptions.push(
    log,
    player,
    new TriggerHandler(startById, log),
    vscode.commands.registerCommand("agentTour.spike.start", () => startSpikeTour(player, log)),
    vscode.commands.registerCommand("agentTour.next", () => player.next()),
    vscode.commands.registerCommand("agentTour.previous", () => player.previous()),
    vscode.commands.registerCommand("agentTour.showCard", () => player.showCard()),
    vscode.commands.registerCommand("agentTour.stop", () => player.stop()),
  );
  void vscode.commands.executeCommand("setContext", "agentTour.active", false);
  log.info(`Activated (VS Code ${vscode.version})`);

  return { player };
}

async function startSpikeTour(player: TourPlayer, log: vscode.LogOutputChannel): Promise<void> {
  const firstFile = SPIKE_TOUR.steps[0].file;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const uri = resolveWorkspaceFile(folder.uri, firstFile);
    if (uri && (await exists(uri))) {
      await player.start(SPIKE_TOUR, folder.uri);
      return;
    }
  }
  log.warn("Spike tour needs the fixture workspace open");
  void vscode.window.showErrorMessage(
    "Agent Tour: open extension/test/fixtures/spike-workspace to run the spike tour.",
  );
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export function deactivate(): void {}
