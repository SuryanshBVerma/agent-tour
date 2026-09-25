# Agent Code Tours (PoC)

A VS Code extension plus a Claude Code skill. After an agent finishes a multi-file change,
the skill has it write a tour and publish it with the bundled validator into a per-user temp
folder (one slot per workspace, never inside the repository; see `extension/src/tourLocation.ts`).
The extension then plays the
tour in the real editor: the target lines are spotlighted, the rest of the file is dimmed,
each step gets a description card, and the developer moves through it with the keyboard.

The full plan is in `docs/implementation-plan.md`, and it is the source of truth for scope.
Log non-obvious decisions and deviations from the plan in `docs/decisions.md`.

## Layout
- `extension/`: VS Code extension (TypeScript). `extension/schema/tour.schema.json` is the
  canonical tour contract.
- `skill/code-tour/`: the agent skill (SKILL.md, validator, examples). Its
  `schema/tour.schema.json` is a build-time copy of the extension schema. Never edit the copy.
- `docs/`: plan and decision log.

## Commands (run in `extension/`)
- `npm run compile` builds with tsc into `out/`.
- `npm test` runs mocha tests in VS Code 1.90.0, the minimum in `engines` (`.vscode-test.mjs`;
  set `VSCODE_TEST_VERSION=stable` for the newest release; CI runs both) against
  `test/fixtures/sample-workspace`. Tests publish tours from `test/fixtures/tours/` into that
  workspace's temp slot and clear it afterwards.
- To try it manually, press F5 and choose "Run Agent Tour (sample workspace)" from the repo root.
- `npm run compile` also rebuilds the skill's generated files (the validator bundle and the
  schema copy); commit them together with source changes. `npm run check:skill` fails if
  they are stale.
- `npm run test:skill` runs the validator tests (`node --test`, no VS Code needed).
- `npm run package` builds `agent-tour.vsix`.
- `npm run sample-tour` publishes the fixture tour for the sample workspace (F5 does this).
- Releasing: bump `version` in `extension/package.json`, add a `CHANGELOG.md` section, then
  push a `vX.Y.Z` tag.

## Status
- Phase 0: the code is done, and the manual checks in `docs/phase0-spike.md` are pending.
- Phase 1 (core): done. Schema, TourStore and watcher, auto-start, and the Start Tour
  quick pick are in place.
- Phase 2 (robustness): done. AnchorResolver with relocated, stale and missing steps, the
  TourTree in the Explorer, and Workspace Trust restricted settings are in place. Manual
  checks are in `docs/manual-checks.md`.
- Phase 3 (skill): done. `skill/code-tour/` holds SKILL.md, the bundled validator
  `scripts/validate-tour.mjs`, and an example. The validator's source is
  `extension/skill-src/`.
- v0.1.0 prepared for GitHub (SuryanshBVerma/agent-tour, MIT). Tours live in a per-user temp
  slot (not the repo); the inline card is the default; kinds are colored. CI is
  `.github/workflows/ci.yml` and releases come from `release.yml` on `v*.*.*` tags.
- Next is Phase 4: dogfooding on real projects.

## Tour contract (summary)
- Lines are 1-based and inclusive. `file` is workspace-relative; reject absolute paths and `..`.
- `id` must match `^[a-z0-9][a-z0-9-]{0,80}$`.
- `kind` is one of `change | context | risk | decision`.
- `anchor` is an exact snippet from the first meaningful line of the range, used for relocation.

## Security rules (non-negotiable)
- `MarkdownString.isTrusted` is set to `{ enabledCommands: [...] }` listing only this
  extension's commands. Never set it to `true`. Set `supportHtml = false`.
- Schema-validate every tour before use.
- The URI handler accepts only a regex-validated `id`. Never read paths or content from a URI.
- No auto-start in untrusted workspaces. No network access and no telemetry.

## Conventions
- Extension ID `agent-tour.agent-tour`. Settings and context keys use the `agentTour.` prefix.
- Keep the opacity-dimming hack isolated in `spotlightRenderer.ts` behind a flag, with a
  background-wash fallback.
- Every decoration must be disposed on step change, file switch, and stop.
