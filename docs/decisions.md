# Decision Log

Record non-obvious decisions and deviations from `implementation-plan.md`, newest first.
Include the date, the decision, why it was made, and the alternatives considered.

## 2026-09-25: Phase 1 core implementation choices
- **ajv as a runtime dependency, draft-07 schema.** `extension/schema/tour.schema.json` is
  canonical and is also contributed via `jsonValidation`, so editing a tour in VS Code gets
  completion and squiggles. Checks JSON Schema can't express (`end >= start`, id matches the
  file name, path safety beyond the pattern) live in `tourValidation.ts`, which the Phase 3
  validator can reuse.
- **The file name must equal `<id>.json`.** Lookup by id (URI handler, `agentTour.start`)
  then needs only one file read, and one file can't impersonate another tour's id.
  Duplicate ids across workspace folders: the first one wins and a warning is logged.
- **Invalid tours are kept with their errors, not dropped.** A watcher-seen invalid file
  raises a warning with "Show Errors" (unless autoStart is off), so an agent's broken tour
  is visible. Phase 2's TourTree can list them.
- **Only watcher events trigger auto-start.** Tours already on disk at activation never
  start or prompt on their own.
- **Auto-start "on" rules:** it never replaces a running tour without asking. It waits
  for 3 s with no keyboard or mouse input and no dirty edits in the active editor, for up
  to 30 s, then falls back to a prompt. A reload from disk doesn't make a document dirty,
  so an agent's writes don't count as user input.
- **A rewritten file for the playing tour reloads in place** at the same step (clamped).
  A deleted one stops the tour.
- **`find(id)` reads from disk,** so a start URI sent right after the agent writes the file
  works before the watcher's 250 ms debounce fires.
- **Test hook `snapshot().decorated`.** The VS Code API can't read decorations back, so the
  renderer tracks what it has set per visible editor. The tests assert cleanup against that.
- **Fixture renamed `spike-workspace` → `sample-workspace`;** the hardcoded tour became
  `.agent-tours/2026-09-25-rate-limiting.json` plus four invalid fixtures. `.gitignore` now
  ignores only the repo-root `/.agent-tours/`.

## 2026-09-25: Phase 0 spike implementation choices
- **Minimum VS Code 1.138.** `engines.vscode` is `^1.138.0`, matching the newest
  `@types/vscode` on npm. Integration tests are pinned to 1.138.0, the declared minimum.
  The team runs 1.139.
- **TypeScript 5.9, plain `tsc`, no bundler.** TypeScript 7 (the native port) is the npm
  `latest`, but 5.9 is the proven line for VS Code tooling. Bundling can wait until
  packaging.
- **`agentTour.dimMode` setting (`opacity | wash | off`).** This is the "flag" the plan
  asks for around opacity dimming, exposed as a setting so testers can switch to the
  fallback without a rebuild. `dimOpacity` is clamped to a number in [0.05, 1] before it
  is put into the CSS string, because workspace settings from an untrusted repo could
  otherwise inject CSS.
- **Card images neutralized.** Agent-written descriptions have `![` escaped, so a card can
  never fetch remote content, which keeps the "no network access" rule. Links still work,
  but only when clicked.
- **Cursor placed on a non-identifier position.** The card shares the hover widget with
  language hovers. The cursor goes to the first spot on the start line that touches no
  identifier, to reduce type and doc hovers stacking with the card. Manual check 6 in
  `phase0-spike.md` confirms whether this is enough.
- **Esc stops the tour only when nothing else claims it** (no hover, suggest, find,
  selection or snippet). This avoids stealing Esc from normal editing.
- **URI ids:** exactly one `id` parameter, matching the id regex; anything else is ignored.

## 2026-09-25: Repository root is `code-tour/`
The plan names the root `agent-tour/`. The working folder is `D:\Projects\code-tour`, so the
planned layout (`CLAUDE.md`, `docs/`, `extension/`, `skill/`) sits directly under it.
The extension ID stays `trivium.agent-tour`.
