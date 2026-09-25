// No vscode import: shared with the bundled skill validator, which runs under plain node.
//
// Tours are temporary review aids, so they never live in the repository. Each workspace
// gets one slot in a per-user temp folder, and every new tour for that workspace replaces
// the previous one:
//
//   <os.tmpdir()>/agent-tours-<user>/<key>.json          the current tour (watched)
//   <os.tmpdir()>/agent-tours-<user>/drafts/<key>.json   where the agent writes a draft
//
// <key> is a hash of the workspace root, so the agent (via the validator) and the
// extension find the same slot without either one storing paths anywhere.
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Per-user folder holding every workspace's current tour. */
export function tourRoot(): string {
  const user = (safeUserName() || "user").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64);
  return path.join(realTempDir(), `agent-tours-${user}`);
}

/**
 * os.tmpdir() can be a Windows 8.3 short path (C:\Users\ABCDEF~1\...) while file-watcher
 * events report the long path, so events would never match the watched folder. The
 * native realpath expands it (and resolves symlinked temp dirs such as macOS /var).
 */
function realTempDir(): string {
  const tmp = os.tmpdir();
  try {
    return fs.realpathSync.native(tmp);
  } catch {
    return tmp;
  }
}

/** Stable key for a workspace root: same folder → same key, on any process of this user. */
export function workspaceKey(workspaceRoot: string): string {
  let resolved = path.resolve(workspaceRoot);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // Not on disk (yet): hash the resolved path as-is.
  }
  let normalized = resolved.replace(/\\/g, "/").replace(/\/+$/, "");
  if (process.platform === "win32" || process.platform === "darwin") {
    normalized = normalized.toLowerCase(); // Case-insensitive file systems by default.
  }
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/** The watched slot for a workspace's current tour. */
export function tourSlotPath(workspaceRoot: string): string {
  return path.join(tourRoot(), `${workspaceKey(workspaceRoot)}.json`);
}

/** Where the agent writes its draft; not watched, so invalid drafts never reach the editor. */
export function tourDraftPath(workspaceRoot: string): string {
  return path.join(tourRoot(), "drafts", `${workspaceKey(workspaceRoot)}.json`);
}

/**
 * Creates the tour folders if needed. On POSIX they are private to this user (0700),
 * because /tmp is shared: another user must not be able to plant tours.
 */
export function ensureTourRoot(): string {
  const root = tourRoot();
  fs.mkdirSync(path.join(root, "drafts"), { recursive: true, mode: 0o700 });
  return root;
}

/**
 * Returns a reason the tour folder must not be trusted, or undefined if it is safe:
 * on POSIX it must be owned by this user and not writable by group or others (a
 * pre-created, attacker-owned folder in /tmp is the case this guards against).
 * Windows temp folders are already per-user.
 */
export function tourRootProblem(root = tourRoot()): string | undefined {
  if (process.platform === "win32" || typeof process.getuid !== "function") {
    return undefined;
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(root);
  } catch {
    return undefined; // Does not exist yet; ensureTourRoot creates it privately.
  }
  if (!stat.isDirectory()) {
    return `${root} is not a directory`;
  }
  if (stat.uid !== process.getuid()) {
    return `${root} is owned by another user`;
  }
  if ((stat.mode & 0o022) !== 0) {
    return `${root} is writable by other users`;
  }
  return undefined;
}

/**
 * Writes the tour atomically: a temp file in the same folder, then a rename, so the
 * watcher never observes a half-written file.
 */
export function writeTourAtomically(target: string, content: string): void {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, target);
}

function safeUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "";
  }
}
