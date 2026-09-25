# Decision Log

Record non-obvious decisions and deviations from `implementation-plan.md`, newest first.
Include the date, the decision, why it was made, and the alternatives considered.

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
