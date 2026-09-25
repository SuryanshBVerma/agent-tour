import * as path from "path";
import * as vscode from "vscode";
import { ensureTourRoot, tourRootProblem, workspaceKey } from "./tourLocation";
import { validateTour } from "./tourValidation";
import { Tour, TOUR_ID_PATTERN } from "./types";

/** Tours are small; anything larger is almost certainly not a tour. */
const MAX_TOUR_BYTES = 1024 * 1024;
/** Writes are atomic renames, but a watcher can still report create + change; coalesce. */
const WATCH_DEBOUNCE_MS = 250;
/**
 * A watcher on a folder outside the workspace takes a moment to start, so events right
 * after (re)creating it can be missed. Re-scan the slots once it has settled.
 */
const SETTLE_RESCAN_MS = 1000;

export interface LoadedTour {
  tour: Tour;
  folder: vscode.Uri;
  uri: vscode.Uri;
}

export interface InvalidTour {
  uri: vscode.Uri;
  folder: vscode.Uri;
  errors: string[];
}

export type TourChange =
  | { type: "loaded"; loaded: LoadedTour; fromWatcher: boolean }
  | { type: "invalid"; invalid: InvalidTour; fromWatcher: boolean }
  /** `id` is undefined when the removed slot held an invalid tour. */
  | { type: "removed"; id: string | undefined; uri: vscode.Uri };

/**
 * Holds the current tour of each open workspace folder. Tours live outside the
 * repository, in one slot per workspace in a per-user temp folder (see tourLocation.ts);
 * a new tour for a workspace replaces the previous one. Slots belonging to workspaces
 * that are not open here are ignored. Invalid slots are kept with their errors so they
 * can be reported instead of silently ignored.
 */
export class TourStore implements vscode.Disposable {
  private readonly tours = new Map<string, LoadedTour>();
  private readonly invalid = new Map<string, InvalidTour>();
  /** Slot file name (`<key>.json`) → workspace folder it belongs to. */
  private folderBySlot = new Map<string, vscode.Uri>();
  private root: string | undefined;
  private watcher: vscode.Disposable | undefined;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private settleTimer: NodeJS.Timeout | undefined;
  /** Slot URI → "mtime:size" of the version last loaded, to skip unchanged re-reads. */
  private readonly seen = new Map<string, string>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<TourChange>();

  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.subscriptions.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reload()),
      // Safety net for missed watcher events: the usual flow is an agent publishing from a
      // terminal or another window, then the developer switching back to VS Code.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          void this.rescan();
        }
      }),
    );
  }

  all(): LoadedTour[] {
    return [...this.tours.values()].sort((a, b) => b.tour.id.localeCompare(a.tour.id));
  }

  invalidTours(): InvalidTour[] {
    return [...this.invalid.values()];
  }

  get(id: string): LoadedTour | undefined {
    return this.tours.get(id);
  }

  /** The slot file this store reads for a workspace folder, or undefined if unavailable. */
  slotFor(folder: vscode.Uri): vscode.Uri | undefined {
    return this.root ? vscode.Uri.file(path.join(this.root, `${workspaceKey(folder.fsPath)}.json`)) : undefined;
  }

  /**
   * Looks a tour up by id, re-reading the slots from disk first so a start link sent right
   * after the agent published the tour works before the watcher has fired.
   */
  async find(id: string): Promise<LoadedTour | InvalidTour | undefined> {
    if (!TOUR_ID_PATTERN.test(id)) {
      return undefined;
    }
    for (const [slotName, folder] of this.folderBySlot) {
      const result = await this.load(vscode.Uri.file(path.join(this.root!, slotName)), folder, false);
      if (result && "tour" in result && result.tour.id === id) {
        return result;
      }
    }
    return this.tours.get(id);
  }

  /** Re-reads every open folder's slot and recreates the watcher. */
  async reload(): Promise<void> {
    this.disposeWatcher();
    this.tours.clear();
    this.invalid.clear();
    this.seen.clear();
    this.folderBySlot = new Map(
      (vscode.workspace.workspaceFolders ?? [])
        .filter((folder) => folder.uri.scheme === "file")
        .map((folder) => [`${workspaceKey(folder.uri.fsPath)}.json`, folder.uri]),
    );

    const problem = tourRootProblem();
    if (problem) {
      // Security: a folder another user controls could feed us tours.
      this.root = undefined;
      this.log.error(`Not loading tours: ${problem}`);
      void vscode.window.showErrorMessage(`Agent Tour: not loading tours because ${problem}.`);
      return;
    }
    try {
      this.root = ensureTourRoot();
    } catch (error) {
      this.root = undefined;
      this.log.error(`Cannot create the tour folder: ${String(error)}`);
      return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(this.root), "*.json"),
    );
    watcher.onDidCreate((uri) => this.schedule(uri));
    watcher.onDidChange((uri) => this.schedule(uri));
    watcher.onDidDelete((uri) => this.remove(uri));
    this.watcher = watcher;

    for (const [slotName, folder] of this.folderBySlot) {
      await this.load(vscode.Uri.file(path.join(this.root, slotName)), folder, false);
    }
    this.settleTimer = setTimeout(() => void this.rescan(), SETTLE_RESCAN_MS);
    this.log.info(`Watching ${this.root}: ${this.tours.size} tour(s), ${this.invalid.size} invalid`);
  }

  /**
   * Re-reads slots whose file changed (or appeared, or vanished) since last loaded, as if
   * the watcher had reported it. Unchanged slots are skipped.
   */
  async rescan(): Promise<void> {
    if (!this.root) {
      return;
    }
    for (const [slotName, folder] of this.folderBySlot) {
      const uri = vscode.Uri.file(path.join(this.root, slotName));
      const version = await fileVersion(uri);
      const known = this.seen.get(uri.toString());
      if (version === undefined) {
        if (known !== undefined) {
          this.remove(uri);
        }
      } else if (version !== known) {
        this.log.info(`Re-scan found a new tour for ${folder.fsPath}`);
        await this.load(uri, folder, true);
      }
    }
  }

  dispose(): void {
    this.disposeWatcher();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private schedule(uri: vscode.Uri): void {
    const folder = this.folderBySlot.get(path.basename(uri.fsPath));
    if (!folder) {
      return; // Another workspace's tour.
    }
    const key = uri.toString();
    clearTimeout(this.pending.get(key));
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        void this.load(uri, folder, true);
      }, WATCH_DEBOUNCE_MS),
    );
  }

  private async load(
    uri: vscode.Uri,
    folder: vscode.Uri,
    fromWatcher: boolean,
  ): Promise<LoadedTour | InvalidTour | undefined> {
    const version = await fileVersion(uri);
    if (version === undefined) {
      // No tour yet, or a late watcher event after deletion: a removal, not an error.
      this.remove(uri);
      return undefined;
    }
    if (fromWatcher && this.seen.get(uri.toString()) === version) {
      // Already loaded this exact file (e.g. the watcher reporting a write we read directly).
      return this.tours.get(this.idAt(uri) ?? "") ?? this.invalid.get(uri.toString());
    }
    this.seen.set(uri.toString(), version);
    const result = await readAndValidate(uri).catch((error: unknown) => [String(error)]);
    if (Array.isArray(result)) {
      const invalid = { uri, folder, errors: result };
      this.forget(uri);
      this.invalid.set(uri.toString(), invalid);
      this.log.warn(`Invalid tour for ${folder.fsPath}:\n  ${result.join("\n  ")}`);
      this.changeEmitter.fire({ type: "invalid", invalid, fromWatcher });
      return invalid;
    }

    const tour = result;
    const existing = this.tours.get(tour.id);
    if (existing && existing.uri.toString() !== uri.toString()) {
      this.log.warn(`Tour id "${tour.id}" is already loaded for ${existing.folder.fsPath}; ignoring the copy for ${folder.fsPath}`);
      return existing;
    }
    // A slot holds one tour: drop whatever this slot held before (possibly another id).
    this.forget(uri);
    const loaded: LoadedTour = { tour, folder, uri };
    this.invalid.delete(uri.toString());
    this.tours.set(tour.id, loaded);
    this.changeEmitter.fire({ type: "loaded", loaded, fromWatcher });
    return loaded;
  }

  private remove(uri: vscode.Uri): void {
    clearTimeout(this.pending.get(uri.toString()));
    this.pending.delete(uri.toString());
    this.seen.delete(uri.toString());
    const id = this.forget(uri);
    const wasInvalid = this.invalid.delete(uri.toString());
    if (id || wasInvalid) {
      this.log.info(`Tour slot ${uri.fsPath} removed`);
      this.changeEmitter.fire({ type: "removed", id, uri });
    }
  }

  private idAt(uri: vscode.Uri): string | undefined {
    for (const [id, loaded] of this.tours) {
      if (loaded.uri.toString() === uri.toString()) {
        return id;
      }
    }
    return undefined;
  }

  /** Drops whichever loaded tour came from `uri`; returns its id. */
  private forget(uri: vscode.Uri): string | undefined {
    for (const [id, loaded] of this.tours) {
      if (loaded.uri.toString() === uri.toString()) {
        this.tours.delete(id);
        return id;
      }
    }
    return undefined;
  }

  private disposeWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
  }
}

/** Returns the validated tour, or a list of human-readable errors. */
async function readAndValidate(uri: vscode.Uri): Promise<Tour | string[]> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > MAX_TOUR_BYTES) {
    return [`file is ${stat.size} bytes; the limit is ${MAX_TOUR_BYTES}`];
  }
  const text = new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(uri));
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    return [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
  const result = validateTour(data);
  return result.ok ? result.tour : result.errors;
}

/** "mtime:size" of a file, or undefined if it does not exist. Atomic publishes change both. */
async function fileVersion(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return `${stat.mtime}:${stat.size}`;
  } catch {
    return undefined;
  }
}
