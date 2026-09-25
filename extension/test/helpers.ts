import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { AgentTourApi } from "../src/extension";
import type { Tour } from "../src/types";

/** Compiled tests run from out/test, so step back to the source fixtures. */
export const WORKSPACE_DIR = path.resolve(__dirname, "../../test/fixtures/sample-workspace");
export const TOURS_DIR = path.join(WORKSPACE_DIR, ".agent-tours");
export const SAMPLE_ID = "2026-09-25-rate-limiting";

export function readFixtureTour(id: string): Tour {
  return JSON.parse(fs.readFileSync(path.join(TOURS_DIR, `${id}.json`), "utf8")) as Tour;
}

export const SAMPLE_TOUR = readFixtureTour(SAMPLE_ID);

export async function api(): Promise<AgentTourApi> {
  const extension = vscode.extensions.getExtension<AgentTourApi>("trivium.agent-tour");
  assert.ok(extension, "extension not found");
  return extension.activate();
}

/** Polls until `predicate` holds, failing after `timeoutMs`. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  what: string,
  diagnose?: () => string,
): Promise<number> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      assert.fail(`timed out after ${timeoutMs} ms waiting for ${what}${diagnose ? `; ${diagnose()}` : ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return Date.now() - started;
}

export async function setAutoStart(mode: "off" | "prompt" | "on" | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration("agentTour")
    .update("autoStart", mode, vscode.ConfigurationTarget.Global);
}

export async function resetEditor(): Promise<void> {
  await vscode.commands.executeCommand("agentTour.stop");
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}
