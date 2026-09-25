import * as vscode from "vscode";
import { TOUR_ID_PATTERN } from "./types";

export type StartById = (id: string) => Promise<void>;

/**
 * Handles `vscode://trivium.agent-tour/start?id=<id>`. Only a regex-validated id is read
 * from the URI; paths and content never are. Refuses in untrusted workspaces.
 */
export class TriggerHandler implements vscode.UriHandler, vscode.Disposable {
  private readonly registration: vscode.Disposable;

  constructor(
    private readonly startById: StartById,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.registration = vscode.window.registerUriHandler(this);
  }

  async handleUri(uri: vscode.Uri): Promise<void> {
    // Logged with a timestamp so Phase 0 can measure `code --open-url` delivery.
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
    await this.startById(id);
  }

  dispose(): void {
    this.registration.dispose();
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
