# Testing Agent Tour on Another Project

This guide is for trying the extension on a real repository before the Phase 3 skill exists.

## 1. Build and install
```bash
cd D:/Projects/code-tour/extension && npm run package
```

```bash
code --install-extension D:/Projects/code-tour/extension/agent-tour.vsix
```

Reload VS Code afterwards. To remove it later:

```bash
code --uninstall-extension trivium.agent-tour
```

To pick up changes made here, rebuild the package and reinstall it (`--force` overwrites
the same version).

## 2. Get a tour into the project
Tours live in `<project>/.agent-tours/<id>.json`. You'll probably want to add `.agent-tours/`
to that project's `.gitignore`.

Until the `code-tour` skill is written, ask Claude Code in the other project to write one
by pasting this prompt after it finishes a multi-file change:

> Write a guided code tour of the changes you just made, for review in VS Code.
> 1. Run `git diff --unified=0 <base>` and `git status` (include untracked files).
>    Record the base ref.
> 2. Order the steps as a narrative: entry point, then data/control flow, then tests and
>    config. Group tightly related hunks into one step. Aim for 5–12 steps of 3–40 lines.
>    Fold trivial changes (renames, imports) into the summary.
> 3. Each description uses **What:** / **Why:** (alternatives considered) / **Watch for:**
>    (edge cases, assumptions, uncertainty). Use `kind: "risk"` for low-confidence code.
> 4. Write `.agent-tours/<id>.json`. The id is lowercase letters, digits and hyphens (for
>    example `2026-09-25-add-caching`), and the file name must equal the id.
>    Format: `{ "version": 1, "id", "title", "summary", "baseRef", "createdBy": "claude-code",
>    "steps": [{ "file" (workspace-relative), "range": { "start", "end" } (1-based,
>    inclusive), "anchor" (exact text copied from the first meaningful line of the range),
>    "kind" ("change" | "context" | "risk" | "decision"), "title", "description" (Markdown) }] }`.
> 5. Re-read each file and confirm that every step's `range.start` line contains its `anchor`.

The installed extension gives schema completion and error squiggles when you open the tour
file in VS Code. Invalid files show up in **Explorer → Agent Tours** with their errors.

## 3. Play it
- **Auto-start:** with the default `agentTour.autoStart: "prompt"`, a "Start Tour"
  notification appears when the file is written.
- **Manually:** run **Agent Tour: Start Tour...**, or click a step in **Explorer → Agent Tours**.
- **By link:** `code --open-url "vscode://trivium.agent-tour/start?id=<id>"`. This is Phase 0
  manual check 10; the installed extension is the setup that check is meant for.

Keys while a tour plays: `Alt+]` next, `Alt+[` previous, `Alt+H` show the card again, `Esc` stop.
The log is in **Output → Agent Tour**.

## 4. What to note
- Did the tour order and descriptions help, compared with reading the diff?
- Any step highlighting the wrong lines, marked stale, or reported as a missing file?
- Card problems: not appearing, closing too easily, crowded by language hovers.
- Dimming: readable in your theme? (Try `agentTour.dimMode: "wash"` if not.)
- Keybinding conflicts in your setup.

Notes like these feed straight into Phase 3, which is mostly about tour quality.
