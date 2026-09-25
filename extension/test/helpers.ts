import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { AgentTourApi } from "../src/extension";
import { ensureTourRoot, tourSlotPath, writeTourAtomically } from "../src/tourLocation";
import type { Tour } from "../src/types";

/** Compiled tests run from out/test, so step back to the source fixtures. */
export const WORKSPACE_DIR = path.resolve(__dirname, "../../test/fixtures/sample-workspace");
export const TOUR_FIXTURES = path.resolve(__dirname, "../../test/fixtures/tours");
export const SAMPLE_ID = "2026-09-25-rate-limiting";

export function readFixtureTour(name: string): Tour {
  return JSON.parse(fs.readFileSync(path.join(TOUR_FIXTURES, `${name}.json`), "utf8")) as Tour;
}

export const SAMPLE_TOUR = readFixtureTour(SAMPLE_ID);

/** The slot the extension watches for the sample workspace (outside the repository). */
export const SLOT_PATH = tourSlotPath(WORKSPACE_DIR);

/** Publishes a tour (or raw file content) into the sample workspace's slot, as the skill does. */
export function publish(tour: Tour | string): void {
  ensureTourRoot();
  writeTourAtomically(SLOT_PATH, typeof tour === "string" ? tour : JSON.stringify(tour, null, 2));
}

export function clearSlot(): void {
  fs.rmSync(SLOT_PATH, { force: true });
}

export async function api(): Promise<AgentTourApi> {
  const extension = vscode.extensions.getExtension<AgentTourApi>("agent-tour.agent-tour");
  assert.ok(extension, "extension not found");
  return extension.activate();
}

/** Puts the sample tour in the slot and makes sure the store has read it. */
export async function useSampleTour(): Promise<AgentTourApi> {
  const extension = await api();
  publish(SAMPLE_TOUR);
  await extension.store.reload();
  assert.ok(extension.store.get(SAMPLE_ID), "sample tour not loaded");
  return extension;
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

/**
 * Plan acceptance criterion: a written tour starts within 2 s. CI runners are slower and
 * noisier, so CI (which sets CI=true) measures against 5 s instead; the local run keeps 2 s.
 */
export const LATENCY_BUDGET_MS = process.env.CI ? 5000 : 2000;
/** For waits that only need the file-watcher event to arrive, not to be fast. */
export const WATCH_TIMEOUT_MS = 5000;
