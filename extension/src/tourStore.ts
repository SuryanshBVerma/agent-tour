import * as path from "path";
import * as vscode from "vscode";
import { isSafeRelativePath } from "./pathRules";
import { validateTour } from "./tourValidation";
import { Tour, TOUR_ID_PATTERN } from "./types";

/** Tours are small; anything larger is almost certainly not a tour. */
const MAX_TOUR_BYTES = 1024 * 1024;
/** Agents may write a file in several chunks; wait for writes to settle. */
const WATCH_DEBOUNCE_MS = 250;

export interface LoadedTour {
  tour: Tour;
  folder: vscode.Uri;
  uri: vscode.Uri;
}

export interface InvalidTour {
  uri: vscode.Uri;
  errors: string[];
}

export type TourChange =
  | { type: "loaded"; loaded: LoadedTour; fromWatcher: boolean }
  | { type: "invalid"; invalid: InvalidTour; fromWatcher: boolean }
  /** `id` is undefined when the removed file was an invalid tour. */
  | { type: "removed"; id: string | undefined; uri: vscode.Uri };

/**
 * Discovers `<folder>/<tourDirectory>/<id>.json` in every workspace folder, validates
 * them, and watches for changes. Invalid files are kept with their errors so they can
 * be reported instead of silently ignored.
 */
export class TourStore implements vscode.Disposable {
  private readonly tours = new Map<string, LoadedTour>();
  private readonly invalid = new Map<string, InvalidTour>();
  private readonly watchers: vscode.Disposable[] = [];
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<TourChange>();

  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.subscriptions.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reload()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("agentTour.tourDirectory")) {
          void this.reload();
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

  /**
   * Looks a tour up by id, reading it from disk if the watcher has not caught up yet
   * (e.g. a start link that arrives right after the agent wrote the file).
   */
  async find(id: string): Promise<LoadedTour | InvalidTour | undefined> {
    if (!TOUR_ID_PATTERN.test(id)) {
      return undefined;
    }
    for (const { folder, directory } of this.tourDirectories()) {
      const uri = vscode.Uri.joinPath(directory, `${id}.json`);
      if (await exists(uri)) {
        const result = await this.load(uri, folder, false);
        if (result) {
          return result;
        }
      }
    }
    return this.tours.get(id);
  }

  /** Rescans every tour directory and recreates the watchers. */
  async reload(): Promise<void> {
    this.disposeWatchers();
    this.tours.clear();
    this.invalid.clear();

    for (const { folder, directory, relative } of this.tourDirectories()) {
      // Pattern relative to the workspace folder so it falls inside the workspace's own
      // recursive watcher and also covers a tour directory that does not exist yet.
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, `${relative}/*.json`),
      );
      watcher.onDidCreate((uri) => this.schedule(uri, folder));
      watcher.onDidChange((uri) => this.schedule(uri, folder));
      watcher.onDidDelete((uri) => this.remove(uri));
      this.watchers.push(watcher);

      let entries: [string, vscode.FileType][] = [];
      try {
        entries = await vscode.workspace.fs.readDirectory(directory);
      } catch {
        continue; // Directory does not exist yet; the watcher still sees files appear in it.
      }
      for (const [name, type] of entries) {
        if (type === vscode.FileType.File && name.endsWith(".json")) {
          await this.load(vscode.Uri.joinPath(directory, name), folder, false);
        }
      }
    }
    this.log.info(`Loaded ${this.tours.size} tour(s), ${this.invalid.size} invalid`);
  }

  dispose(): void {
    this.disposeWatchers();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private tourDirectories(): { folder: vscode.Uri; directory: vscode.Uri; relative: string }[] {
    const configured = vscode.workspace.getConfiguration("agentTour").get<string>("tourDirectory", ".agent-tours");
    const normalized = configured.replace(/\\/g, "/").replace(/\/+$/, "");
    // Glob characters would change the watcher pattern, so they are not allowed.
    const relative = isSafeRelativePath(normalized) && !/[*?[\]{}!]/.test(normalized) ? normalized : ".agent-tours";
    if (relative !== normalized) {
      this.log.warn(`agentTour.tourDirectory "${configured}" must be a plain workspace-relative folder; using .agent-tours`);
    }
    return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      folder: folder.uri,
      directory: vscode.Uri.joinPath(folder.uri, relative),
      relative,
    }));
  }

  private schedule(uri: vscode.Uri, folder: vscode.Uri): void {
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
    const fileId = path.posix.basename(uri.path, ".json");
    if (!(await exists(uri))) {
      // A late create/change event can arrive after the file was deleted; that is a
      // removal, not an invalid tour.
      this.remove(uri);
      return undefined;
    }
    const result = await readAndValidate(uri, fileId).catch((error: unknown) => [String(error)]);
    if (Array.isArray(result)) {
      const invalid = { uri, errors: result };
      this.forget(uri);
      this.invalid.set(uri.toString(), invalid);
      this.log.warn(`Invalid tour ${uri.fsPath}:\n  ${result.join("\n  ")}`);
      this.changeEmitter.fire({ type: "invalid", invalid, fromWatcher });
      return invalid;
    }

    const tour = result;
    const existing = this.tours.get(tour.id);
    if (existing && existing.uri.toString() !== uri.toString()) {
      this.log.warn(`Duplicate tour id "${tour.id}" in ${uri.fsPath}; keeping ${existing.uri.fsPath}`);
      return existing;
    }
    const loaded: LoadedTour = { tour, folder, uri };
    this.invalid.delete(uri.toString());
    this.tours.set(tour.id, loaded);
    this.changeEmitter.fire({ type: "loaded", loaded, fromWatcher });
    return loaded;
  }

  private remove(uri: vscode.Uri): void {
    clearTimeout(this.pending.get(uri.toString()));
    this.pending.delete(uri.toString());
    const id = this.forget(uri);
    const wasInvalid = this.invalid.delete(uri.toString());
    if (id || wasInvalid) {
      this.log.info(`Tour file ${uri.fsPath} removed`);
      this.changeEmitter.fire({ type: "removed", id, uri });
    }
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

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers.length = 0;
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
  }
}

/** Returns the validated tour, or a list of human-readable errors. */
async function readAndValidate(uri: vscode.Uri, fileId: string): Promise<Tour | string[]> {
  if (!TOUR_ID_PATTERN.test(fileId)) {
    return [`file name "${fileId}.json" is not a valid tour id`];
  }
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
  const result = validateTour(data, fileId);
  return result.ok ? result.tour : result.errors;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
