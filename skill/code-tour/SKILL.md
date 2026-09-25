---
name: code-tour
description: Create and start a guided code tour after completing a change that touches
  more than one file or more than ~50 lines, so the developer can review it step by step
  in VS Code. Also use when the user asks to "walk me through", "show me what you did",
  or "give me a tour" of changes.
---

# Code Tour

A code tour is a short, ordered walkthrough of a change. The **Agent Tour** VS Code
extension plays it in the real editor: each step's lines are spotlighted, the rest of the
file is dimmed, and a card shows your explanation. Your job is to write the tour file
`.agent-tours/<id>.json`, validate it, and hand it to the developer.

A good tour is faster to review than the raw diff. It follows the change as a story,
explains *why* rather than restating the code, and points out where you're unsure.

## When not to make one
- The change is trivial: one file and under ~50 lines, unless the user asked for a tour.
- There is no git repository, or no changes against the base ref.
- The work is unfinished or failing. Finish it first, or say in the summary that the
  tour covers a work in progress.

## 1. Collect the changes
1. **Workspace root** is the git top level: `git rev-parse --show-toplevel`. All paths in
   the tour are relative to it, and the tour goes in `<root>/.agent-tours/`. Run the
   commands below from there.
2. **Base ref**:
   - uncommitted work: `HEAD`
   - work committed on a branch, with or without further uncommitted edits:
     `git merge-base HEAD <main branch>`. The diff runs against the working tree, so the
     edits are included.
   - otherwise, whatever the user named

   Record it in the tour as a resolved short SHA (`git rev-parse --short <ref>`), never as
   `HEAD`, which stops meaning anything after the next commit.
3. Get an overview first with `git diff --stat <baseRef>`. Then run
   `git diff --unified=0 <baseRef> -- . ':!*.lock' ':!*-lock.json' ':!*.min.*'` and
   `git status --porcelain -uall`. `-uall` lists individual untracked files, which are part
   of the change. Check each one's size and first lines before reading it in full, and
   skip generated ones (a "generated" banner, build output folders, thousands of lines of
   bundled code). Leave out `.agent-tours/` itself.
4. Line numbers must refer to the files **as they are on disk now**. Always take them from
   the current file, not from the diff's `-` side.

Never give steps to generated, vendored or build output (bundles, lockfiles, copied
schemas, snapshots, minified files): mention them in the summary. Deleted files can't be
shown, since a step must point at an existing file, so mention them in the summary too.

Non-code files get a step when they carry behavior or are the deliverable: agent or skill
instructions, prompts, schemas, CI and deploy config, SQL migrations, a user-facing doc
the change is about. Routine doc and changelog updates go in the summary.

## 2. Plan the order
Order the steps as a narrative, not as a list of files:
1. **Entry point:** where the change starts to matter (route, command, public API, UI event).
2. **Data and control flow:** follow the call path through the new or changed logic.
3. **Supporting pieces:** types, config, migrations.
4. **Tests:** what they prove, and what they don't cover.

Group tightly related hunks into one step, even across a few lines. Fold trivial edits
(imports, renames, formatting, moved code with no logic change) into the summary. The
exception is a move that is itself a design choice (for example, extracting code so a
second consumer can share it): give it a short `decision` step at its new location.

**Size:** aim for **5–8 steps**. The validator warns outside 3–12 and rejects more than
20. Keep each step **3–40 lines**, aimed at the lines that matter, not the whole
function; the validator warns above 40.

## 3. Write each step
| Field | Rule |
|---|---|
| `file` | Workspace-relative path with forward slashes, e.g. `src/api/router.ts`. Never absolute, never `..` |
| `range` | `{ "start": n, "end": m }`: 1-based, inclusive, `end >= start`, in the current file |
| `anchor` | Exact text copied from line `range.start`: a distinctive fragment of **10–80 characters**, such as a signature. The extension uses it to find the step again if lines shift, and the validator warns outside 10–80 |
| `kind` | See below |
| `title` | A few words naming what the step shows, not "Step 3" or a file name |
| `description` | Markdown using the pattern below |

**Choosing `range.start`:** start on the most distinctive line of the step, usually the
signature or the first line of the changed logic. Starting on a doc comment directly above
the code is fine if that comment line is distinctive. If the natural first line is too
short or generic for an anchor (`}`, `await build({`, `return x;`), start one line earlier
or later, whichever is more distinctive.

**Choosing `kind`:** pick one, taking the first that applies:
1. `risk`: you aren't confident the code is correct, or a mistake here would be severe
   (security, data loss, concurrency, money). A routine edge case noted under
   **Watch for:** doesn't make a step a risk; keep risks few, so they stand out.
2. `decision`: the step embodies a design choice with a real alternative the reviewer
   should weigh.
3. `change`: new or modified code.
4. `context`: unchanged code, included only because a change can't be understood without it.

**Description pattern:**

```markdown
**What:** One or two sentences on what this code does in the change.

**Why:** Why it's done this way; name the alternative you rejected and why.

**Watch for:** Edge cases, assumptions, untested paths, anything you're unsure about.
```

| Kind | Needs |
|---|---|
| every kind | **What:** |
| `decision` | **Why:** |
| `risk` | **Watch for:** |

Add the other sections whenever they have real content, and leave them out rather than
write filler. The validator warns when a required section is missing. The card is a
hover, so keep each description to **about 40–150 words**; the validator warns above
1,000 characters.

Be concrete and name the identifiers: *"`refill()` runs lazily on each request, so
there's no timer to clean up"* helps; *"This function handles refilling"* doesn't. Be
honest in **Watch for:**. Flagging real uncertainty is the most valuable part of a tour.

Never put secrets, credentials, tokens or personal data in any tour text. Tours are plain
files that other people may read.

## 4. Write the file
Create `<root>/.agent-tours/<id>.json`. The `id` is lowercase letters, digits and hyphens,
dated and descriptive (e.g. `2026-09-25-rate-limiting`), and the file name must equal the
id. Rewriting a tour for the same change keeps the same id.

The **summary** runs up to about four sentences: what the change does, then the notable
things that have no step (deleted files, generated files, trivial edits; group minor ones
rather than listing each), then the test status. For example: *"Adds per-key token bucket
middleware and wires it into the /api routes. Deletes the unused `legacyThrottle.ts`;
`package-lock.json` changes only for the new dependency. Unit tests pass; not
load-tested."*

Report test status as you know it: "tests pass" only if you ran them; "reported passing,
not re-run" if someone else did; "not run" otherwise.

```json
{
  "version": 1,
  "id": "2026-09-25-rate-limiting",
  "title": "Add rate limiting to public API",
  "summary": "Adds per-key token bucket middleware and wires it into the /api routes. ...",
  "baseRef": "a1b2c3d",
  "createdBy": "claude-code",
  "steps": [
    {
      "file": "src/middleware/rateLimit.ts",
      "range": { "start": 25, "end": 41 },
      "anchor": "export function rateLimiter(",
      "kind": "change",
      "title": "Token bucket middleware",
      "description": "**What:** ...\n\n**Why:** ...\n\n**Watch for:** ..."
    }
  ]
}
```

A complete example is in this skill's folder at `examples/2026-09-25-rate-limiting.json`
(its file name equals its id, as yours must). The full schema is at `schema/tour.schema.json`.

## 5. Validate: required
Run the validator that ships in this skill's folder, from the workspace root:

```bash
node "<this skill's folder>/scripts/validate-tour.mjs" .agent-tours/<id>.json
```

If you can't run it from the root, add `--root "<workspace root>"`. It checks the schema,
that every file exists inside the workspace, that ranges fit the file, that each anchor is
on its `range.start` line, that steps don't overlap, and the size and description rules
above. Fix every `ERROR` and run it again until it prints `VALID`. Errors tell you the fix;
for example, an anchor found on another line comes with the corrected range. Treat `WARN`
lines as review comments on tour quality and fix them unless you have a reason not to.

## 6. Hand it over
- The extension notices the new file and offers to start it (by default it shows a
  "Start Tour" notification), so normally no command is needed. This includes tours you
  made on your own initiative after a change.
- Only if the user asked for the tour itself ("walk me through it", "give me a tour"),
  start it right away:
  `code --open-url "vscode://agent-tour.agent-tour/start?id=<id>"`
- Tell the user in one or two lines, naming the risks you flagged. For example: *"I wrote
  a 7-step tour of the change (`.agent-tours/<id>.json`). Start it from the notification,
  or from Agent Tours in the Explorer. It flags two risks: the cache TTL and the retry
  loop."*
- Check whether tours are ignored by git with `git check-ignore -q .agent-tours/<id>.json`
  (exit code 0 means ignored). If they aren't, mention once that the user may want to add
  `.agent-tours/` to `.gitignore`. Don't edit `.gitignore` yourself unless asked.
- If the user says nothing happened, tours need the **Agent Tour** VS Code extension
  (`agent-tour.agent-tour`).
