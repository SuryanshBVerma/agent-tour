# Implementation Plan: Agent Code Tours PoC (Native Editor Approach)

## 1. Goal
Prove the full loop: an agent finishes a multi-file change, follows the `code-tour`
skill to write a tour, and starts it; the developer steps through the real editor with
the target code spotlighted, the rest dimmed, a description card per step, and keyboard
navigation.

## 2. End-to-end flow
1. The **Agent Tour** extension is installed. The **code-tour skill** is available to the
   agent (repo `.claude/skills/code-tour/` or user level).
2. After a task, the skill has the agent inspect `git diff` against the base ref, group
   hunks into a logical sequence, and write `.agent-tours/<id>.json`.
3. The agent runs the skill's validator script and fixes errors until it passes.
4. The agent starts the tour: the extension's file watcher auto-starts it (setting
   controlled), or the agent runs
   `code --open-url "vscode://agent-tour.agent-tour/start?id=<id>"`.
   (Verify in Phase 0 that `code --open-url` reliably reaches the URI handler on the
   team's OSes; if not, the file watcher is the primary path.)
5. The extension opens the first file, applies the spotlight, and shows the step card.

## 3. Tour format (contract)
```json
{
  "version": 1,
  "id": "2026-09-25-rate-limiting",
  "title": "Add rate limiting to public API",
  "summary": "Adds per-key token bucket middleware and wires it into the router.",
  "baseRef": "a1b2c3d",
  "createdBy": "claude-code",
  "steps": [
    {
      "file": "src/middleware/rateLimit.ts",
      "range": { "start": 12, "end": 34 },
      "anchor": "export function rateLimiter(",
      "kind": "change",
      "title": "Token bucket middleware",
      "description": "**What:** ...\n\n**Why:** ...\n\n**Watch for:** ..."
    }
  ]
}
```
Rules:
- Lines are 1-based, inclusive.
- `anchor`: short exact snippet from the first meaningful line of the range, used to
  relocate the step if lines shift.
- `kind`: `change` | `context` | `risk` | `decision`. Drives highlight color and card label.
- `file`: workspace-relative only. Reject absolute paths and `..`.
- `id`: must match `^[a-z0-9][a-z0-9-]{0,80}$`.

## 4. Extension

### 4.1 Components
| Component | Responsibility | Main APIs |
|---|---|---|
| `TourStore` | Discover, parse, schema-validate tours; watch for new/changed files | `workspace.createFileSystemWatcher`, ajv |
| `AnchorResolver` | Verify range still matches anchor; search nearby, then whole file; else mark stale | `workspace.openTextDocument` |
| `TourPlayer` | State machine idle → playing(i) → ended; start/next/prev/goto/stop | commands, `setContext('agentTour.active')` |
| `SpotlightRenderer` | Target highlight, dim the rest, gutter number, overview ruler, center scroll | `createTextEditorDecorationType`, `revealRange` |
| `StepCard` | Title, kind, progress, description, Next/Prev/Stop links | `HoverProvider`, `editor.action.showHover`, `MarkdownString` |
| `ControlBar` | Persistent step indicator + controls (hovers dismiss easily) | `StatusBarItem`, keybindings |
| `TourTree` | Sidebar list of tours and steps; click to jump | `TreeDataProvider` |
| `TriggerHandler` | Auto-start from watcher; `vscode://` start URI | `window.registerUriHandler` |

### 4.2 Rendering
- **Target decoration:** `isWholeLine`, theme-aware background tint, left border,
  numbered gutter icon, overview-ruler color; one set per `kind`.
- **Dim decoration:** ranges above and below the target with
  `textDecoration: "none; opacity: <agentTour.dimOpacity>"`. Isolated in one module
  behind a flag; fallback is a subtle background wash.
- **Cleanup:** dispose all decorations on step change, file switch, and stop.
- **Step card:** move cursor to target start, run `editor.action.showHover`. The
  `HoverProvider` returns content only while a tour is active and the position is inside
  the current step range. Card: header ("Step 3 of 7 · Risk"), title, Markdown
  description, footer with `‹ Previous · Next › · Stop` as `command:` links.
- **Keybindings** (when `agentTour.active`): `Alt+]` next, `Alt+[` previous,
  `Alt+H` reshow card, `Esc` stop.

### 4.3 Security
- `MarkdownString.isTrusted = { enabledCommands: [<this extension's commands only>] }`;
  never plain `true`. `supportHtml = false`.
- Schema-validate every tour before use. Reject paths outside the workspace.
- URI handler accepts only a regex-validated `id`; never reads content or paths from the URI.
- Respect Workspace Trust: no auto-start in untrusted workspaces.
- No network access, no telemetry.

### 4.4 Settings
- `agentTour.autoStart`: `"off" | "prompt" | "on"`, default `"prompt"`.
- `agentTour.dimOpacity`: number, default `0.35`.
- `agentTour.tourDirectory`: default `.agent-tours`.

### 4.5 Repo layout
```
agent-tour/
  CLAUDE.md
  docs/
    implementation-plan.md
    decisions.md
  extension/
    src/
      extension.ts
      tourStore.ts
      anchorResolver.ts
      tourPlayer.ts
      spotlightRenderer.ts
      stepCard.ts
      controlBar.ts
      tourTree.ts
      triggerHandler.ts
    schema/tour.schema.json
    test/
  skill/
    code-tour/
      SKILL.md
      schema/tour.schema.json      # copied from extension/schema at build time
      scripts/validate-tour.mjs
      examples/example.tour.json
```

## 5. Skill (`code-tour`)

Frontmatter:
```markdown
---
name: code-tour
description: Create and start a guided code tour after completing a change that touches
  more than one file or more than ~50 lines, so the developer can review it step by step
  in VS Code. Also use when the user asks to "walk me through", "show me what you did",
  or "give me a tour" of changes.
---
```

The body must instruct the agent to:
1. **Collect changes:** `git diff --unified=0 <baseRef>` and `git status` (include
   untracked files). Record `baseRef`.
2. **Order by narrative:** entry point → data/control flow → tests and config. Group
   tightly related hunks into one step.
3. **Keep it tight:** about 5–12 steps, 3–40 lines per step. Fold trivial changes
   (renames, imports) into one step or the summary.
4. **Description pattern:** **What** it does, **Why** this way (alternatives
   considered), **Watch for** (edge cases, assumptions, uncertainty). Use
   `kind: "risk"` for low-confidence code.
5. **Context steps sparingly**, only when needed to understand a change.
6. **Validate:** `node scripts/validate-tour.mjs .agent-tours/<id>.json`; fix and rerun
   until it passes.
7. **Start** via auto-start or `code --open-url`, then tell the user in chat that an
   N-step tour is ready.

Validator checks: schema, file exists, range within file length, anchor present at or
near `range.start`, no overlapping steps in one file, step count limits. Non-zero exit
with readable errors.

## 6. Phases (rough effort, one developer)
- **Phase 0 – Spike (1–2 days):** hardcoded tour. Verify target + opacity dimming in
  light and dark themes, reliable programmatic `showHover` at the target, `command:`
  links working under restricted `isTrusted`, and `code --open-url` reaching the URI
  handler. Go/no-go for the approach.
- **Phase 1 – Core (4–6 days):** schema, `TourStore` + watcher, `TourPlayer`,
  `SpotlightRenderer`, `StepCard`, `ControlBar`, keybindings, settings; integration
  tests for navigation and cleanup (`@vscode/test-electron`).
- **Phase 2 – Robustness (2–3 days):** `AnchorResolver` with stale marking, cross-file
  navigation, `TourTree`, URI handler, Workspace Trust.
- **Phase 3 – Skill (2–3 days):** SKILL.md, validator, examples; run the agent on 3–5
  real tasks and refine ordering and description quality.
- **Phase 4 – Dogfood (1 week, part-time):** real use; track review time, skipped
  steps, stale anchors; decide whether a comment-thread card is needed.

## 7. Acceptance criteria
- Valid tour with no human edits in at least 4 of 5 trial tasks.
- Tour starts automatically or with one click within 2 s of the file being written.
- Every step opens the right file, highlights the intended lines, dims the rest, and
  shows its card.
- Stopping, or closing and reopening files mid-tour, leaves no decorations behind.
- Reviewer rates the tour as faster than diff-only review on the same change.

## 8. Risks
| Risk | Mitigation |
|---|---|
| Opacity dimming is undocumented and may break on update | Flag + background-wash fallback; pin minimum tested VS Code version |
| Hover card dismisses too easily | Status bar + keybindings; comment-thread card as a later setting |
| Shallow or badly ordered tours | Strict skill rules, What/Why/Watch-for pattern, validator limits, Phase 3 iteration |
| Stale anchors after further edits | `AnchorResolver` relocation; visible "stale" badge instead of wrong highlight |
| Auto-start takes over the editor mid-typing | Default `"prompt"`; with `"on"`, delay if there was editor input in the last few seconds |

## 9. Out of scope for PoC
Webview card, per-step before/after diff view, review feedback back to the agent,
MCP / language-model-tool integration, Marketplace publishing.

## 10. Later directions (for context only)
- **Hybrid:** keep native spotlight in the editor, move the step card into a styled
  webview panel for the full driver.js look (progress dots, animations).
- **Webview presentation mode:** Monaco-rendered code with real driver.js for demos.
- **Agent-first extras:** MCP tools (`create_tour`, `add_step`, `present_tour`), diff-hunk
  anchoring, structured per-step review feedback returned to the agent.
