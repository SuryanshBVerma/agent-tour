# Agent Code Tours (PoC)

A VS Code extension plus a Claude Code skill. After an agent finishes a multi-file change,
the skill has it write a tour file (`.agent-tours/<id>.json`). The extension then plays the
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
- `npm test` runs mocha tests in VS Code 1.138.0 (`.vscode-test.mjs`) against
  `test/fixtures/spike-workspace`.
- To try it manually, press F5 and choose "Run Agent Tour (spike workspace)" from the repo root.

## Status
Phase 0 spike: the code is done, and the manual checks in `docs/phase0-spike.md` are
pending. `TourStore`, `AnchorResolver`, `TourTree` and the skill are not started yet.

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
