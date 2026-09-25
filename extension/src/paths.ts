import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { isSafeRelativePath, relativeLeavesRoot } from "./pathRules";

export { isSafeRelativePath };

/**
 * Resolves a tour's workspace-relative `file` against a workspace folder.
 * Returns undefined for anything that would land outside the folder, so a tour can
 * never point the editor elsewhere.
 */
export function resolveWorkspaceFile(
  folder: vscode.Uri,
  relativePath: string,
): vscode.Uri | undefined {
  if (!isSafeRelativePath(relativePath)) {
    return undefined;
  }
  const resolved = vscode.Uri.joinPath(folder, relativePath.replace(/\\/g, "/"));
  const relative = path.posix.relative(folder.path, resolved.path);
  if (relativeLeavesRoot(relative) || path.posix.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

/**
 * True if `uri` is still inside `folder` after resolving symlinks, so a symlink in the
 * repository cannot make a tour open a file elsewhere on disk. Non-file schemes
 * (e.g. remote workspaces) have no local realpath and fall back to the lexical check
 * already done by `resolveWorkspaceFile`.
 */
export async function isInsideAfterSymlinks(folder: vscode.Uri, uri: vscode.Uri): Promise<boolean> {
  if (folder.scheme !== "file" || uri.scheme !== "file") {
    return true;
  }
  try {
    const [realFolder, realFile] = await Promise.all([
      fs.promises.realpath(folder.fsPath),
      fs.promises.realpath(uri.fsPath),
    ]);
    const relative = path.relative(realFolder, realFile);
    return !relativeLeavesRoot(relative) && !path.isAbsolute(relative);
  } catch {
    return false; // Missing file: the caller reports it as missing.
  }
}
