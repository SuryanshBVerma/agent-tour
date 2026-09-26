import * as path from "path";
import * as vscode from "vscode";
import { resolveWorkspaceFile } from "./paths";
import { relativeLeavesRoot } from "./pathRules";

/** Where a step's file is at the tour's base ref: the before-side, an added file, or a reason. */
export type BaseResolution =
  | { kind: "ok"; left: vscode.Uri }
  | { kind: "added" }
  | { kind: "unavailable"; reason: string };

/**
 * The part of `GitService` the player needs. Tests supply their own implementation, so the
 * diff behaviour can be exercised without a real repository.
 */
export interface BaseResolver {
  resolveBase(folder: vscode.Uri, relativeFile: string, ref: string): Promise<BaseResolution>;
}

interface GitChange {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly status: number;
}

/** `Status` values from the Git extension API (`git.d.ts`). */
const STATUS_ADDED = 1;
const STATUS_RENAMED = 3;

interface GitRepository {
  readonly rootUri: vscode.Uri;
  getCommit(ref: string): Promise<unknown>;
  getObjectDetails(ref: string, file: string): Promise<unknown>;
  diffWith(ref: string): Promise<GitChange[]>;
}

interface GitApi {
  getRepository(uri: vscode.Uri): GitRepository | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

/**
 * Locates the before-side of a step in the workspace's Git repository through the built-in
 * Git extension API. Nothing is written; no shell is used, so the agent-authored ref cannot
 * reach a command line.
 */
export class GitService implements BaseResolver {
  private apiPromise: Promise<GitApi | undefined> | undefined;
  /** `diffWith(ref)` is per repository and ref; compute it once and reuse it. */
  private readonly changeSets = new Map<string, Promise<GitChange[]>>();

  constructor(private readonly log: vscode.LogOutputChannel) {}

  async resolveBase(folder: vscode.Uri, relativeFile: string, ref: string): Promise<BaseResolution> {
    if (!isValidBaseRef(ref)) {
      return { kind: "unavailable", reason: `the base ref ${JSON.stringify(ref)} is not usable` };
    }
    const api = await this.gitApi();
    if (!api) {
      return { kind: "unavailable", reason: "the built-in Git extension is not available" };
    }
    const workingUri = resolveWorkspaceFile(folder, relativeFile);
    if (!workingUri) {
      return { kind: "unavailable", reason: `${relativeFile} is not a workspace path` };
    }
    const repository = api.getRepository(workingUri) ?? api.getRepository(folder);
    if (!repository) {
      return { kind: "unavailable", reason: "this workspace is not inside a Git repository" };
    }
    const repositoryPath = repositoryRelativePath(repository.rootUri.fsPath, workingUri.fsPath);
    if (repositoryPath === undefined) {
      return { kind: "unavailable", reason: `${relativeFile} is outside the repository` };
    }
    try {
      await repository.getCommit(ref);
    } catch {
      return { kind: "unavailable", reason: `the base ref ${ref} cannot be resolved` };
    }
    const change = await this.changeFor(repository, ref, workingUri).catch(() => undefined);
    if (change) {
      const baseFile = baseFileForChange(change.status, workingUri, change.originalUri);
      if (!baseFile) {
        this.log.info(`"${relativeFile}" is added relative to ${ref}`);
        return { kind: "added" };
      }
      return { kind: "ok", left: api.toGitUri(baseFile, ref) };
    }
    try {
      await repository.getObjectDetails(ref, repositoryPath);
      return { kind: "ok", left: api.toGitUri(workingUri, ref) };
    } catch {
      this.log.info(`"${relativeFile}" does not exist at ${ref}`);
      return { kind: "added" };
    }
  }

  private async gitApi(): Promise<GitApi | undefined> {
    if (!this.apiPromise) {
      this.apiPromise = loadGitApi(this.log);
    }
    return this.apiPromise;
  }

  private changeFor(repository: GitRepository, ref: string, workingUri: vscode.Uri): Promise<GitChange | undefined> {
    const key = `${repository.rootUri.toString()}|${ref}`;
    let pending = this.changeSets.get(key);
    if (!pending) {
      pending = repository.diffWith(ref);
      this.changeSets.set(key, pending);
    }
    return pending.then((changes) => changes.find((change) => sameFilePath(change.uri, workingUri)));
  }
}

async function loadGitApi(log: vscode.LogOutputChannel): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!extension) {
    log.info("Git extension not found; the diff view is unavailable");
    return undefined;
  }
  try {
    const git = extension.isActive ? extension.exports : await extension.activate();
    if (!git.enabled) {
      log.info("Git extension is disabled; the diff view is unavailable");
      return undefined;
    }
    return git.getAPI(1);
  } catch (error) {
    log.warn(`Cannot use the Git extension: ${String(error)}`);
    return undefined;
  }
}

/** Rejects empty, over-long, whitespace/control or option-like refs. No shell is involved. */
export function isValidBaseRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > 200) {
    return false;
  }
  if (ref.startsWith("-")) {
    return false;
  }
  return !/[\s\u0000-\u001f\u007f]/.test(ref);
}

/** Repo-root-relative POSIX path, or undefined when the file is outside the repository. */
export function repositoryRelativePath(rootFsPath: string, fileFsPath: string): string | undefined {
  const relative = path.relative(rootFsPath, fileFsPath);
  if (!relative || relativeLeavesRoot(relative) || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.replace(/\\/g, "/");
}

/**
 * The file whose content at the ref is the before-side of the diff, or undefined for an added
 * file. `Change.originalUri` is the pre-rename path for a rename and the working path otherwise,
 * so the base content must come from `toGitUri(this, ref)`, never from `originalUri` directly.
 */
export function baseFileForChange(
  status: number,
  workingUri: vscode.Uri,
  originalUri: vscode.Uri,
): vscode.Uri | undefined {
  if (status === STATUS_ADDED) {
    return undefined;
  }
  return status === STATUS_RENAMED ? originalUri : workingUri;
}

/** File URIs are case-insensitive on Windows and macOS. */
export function sameFilePath(a: vscode.Uri, b: vscode.Uri): boolean {
  return process.platform === "win32" ? a.fsPath.toLowerCase() === b.fsPath.toLowerCase() : a.fsPath === b.fsPath;
}
