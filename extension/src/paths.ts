import * as path from "path";
import * as vscode from "vscode";

/**
 * Resolves a tour's workspace-relative `file` against a workspace folder.
 * Returns undefined for absolute paths, drive letters, `..` segments, or anything
 * that would land outside the folder, so a tour can never point the editor elsewhere.
 */
export function resolveWorkspaceFile(
  folder: vscode.Uri,
  relativePath: string,
): vscode.Uri | undefined {
  if (!relativePath || relativePath.includes("\0")) {
    return undefined;
  }
  const normalized = relativePath.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }
  const resolved = vscode.Uri.joinPath(folder, normalized);
  const relative = path.posix.relative(folder.path, resolved.path);
  if (relative.startsWith("..") || path.posix.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}
