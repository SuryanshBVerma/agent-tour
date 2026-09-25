import * as path from "path";
import * as vscode from "vscode";

/**
 * True for a workspace-relative path with no absolute prefix, drive letter, NUL byte,
 * or `..` segment. Both `/` and `\` count as separators.
 */
export function isSafeRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes("\0")) {
    return false;
  }
  const normalized = relativePath.replace(/\\/g, "/");
  return (
    !normalized.startsWith("/") &&
    !/^[a-zA-Z]:/.test(normalized) &&
    !normalized.split("/").some((segment) => segment === "..")
  );
}

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
  if (relative.startsWith("..") || path.posix.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}
