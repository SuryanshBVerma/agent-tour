// No vscode import: shared with the bundled skill validator, which runs under plain node.

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
 * True if a `path.relative(root, target)` result points outside `root`. Only a leading
 * `..` *segment* counts: `..config/x` is a legitimate name inside the root.
 */
export function relativeLeavesRoot(relative: string): boolean {
  return relative === ".." || relative.startsWith("../") || relative.startsWith("..\\");
}
