# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- The skill makes unprompted tours only after a large, complex change the agent drove
  itself (more than five non-generated files with real logic), never for direct, scoped
  requests, and never asks whether you want one. Asking for a tour still always works.
- The skill writes the tour draft with a terminal command, so it no longer shows up in the
  session's list of changed files.
- Better step explanations. The skill now asks for a first step that maps the whole change,
  steps that link to each other, no restating of the highlighted code, a last step on what
  the tests do and don't prove, and a summary that ends with what to verify by hand. The
  step count scales with the change, and a focus named by the user gets the most depth.
- New `examples/writing-steps.md` in the skill: weak and strong versions of each kind of step
  and of the summary. The example tour follows the new guidance.
- The skill says what the card can render, mentions `Alt+D` for the diff in its hand-over,
  and sets `createdBy` to the agent's own name, so it reads the same for Copilot and Claude
  Code.

## [0.1.2] - 2026-09-25

### Added
- Per-step side-by-side diff. `Alt+D`, the status-bar diff item, or **Agent Tour: Toggle
  Side-by-Side Diff** shows the current step as the file at the tour's `baseRef` beside the
  working copy. Sticky until toggled off, off by default, and only the modified side is
  spotlighted. Added files, a non-Git workspace, or an unresolvable ref fall back to the usual
  spotlight with one notice.

### Fixed
- The diff's left column now shows the base version. It previously pointed at the working file,
  so both columns showed the same content.

## [0.1.1] - 2026-09-25

### Fixed
- Installs on **VS Code 1.90 and later**. v0.1.0 required 1.138 without needing it, so
  installing on older versions failed with "not compatible with VS Code". Tested on 1.90.0
  and the current stable release; CI now covers both on Ubuntu and Windows.

## [0.1.0] - 2026-09-25

First release.

### Extension
- Plays agent-written tours in the real editor: per-kind spotlight (green change, blue
  context, amber decision, red risk), dimming of everything outside the step, a numbered
  gutter badge and scrollbar marks.
- Step card as an inline card above the step that stays open (`agentTour.cardStyle: "inline"`),
  or as a hover card. The kind is shown as a colored badge.
- Keyboard navigation (`Alt+]`, `Alt+[`, `Alt+H`, `Esc`), status bar controls, and an
  **Agent Tours** view in the Explorer.
- Tours are read from a per-user temp folder with one slot per workspace, never from the
  repository. A newly published tour can auto-start (`agentTour.autoStart`).
- Anchor-based relocation when code moves, plus stale and missing-file handling.
- `vscode://agent-tour.agent-tour/start?id=<id>` start links.
- Security: workspace confinement including symlinks, untrusted card content, a private tour
  folder, Workspace Trust support, and no network access or telemetry.

### Skill (`code-tour`)
- `SKILL.md`: when to make a tour, collecting changes, narrative ordering, step and kind
  rules, the What/Why/Watch-for pattern, and hand-over.
- `validate-tour.mjs` (runs with plain Node.js 18+): `--where` prints the draft path;
  validation checks the schema, files, ranges, anchors, overlaps and quality; `--publish`
  replaces the workspace's tour atomically.

[0.1.2]: https://github.com/SuryanshBVerma/agent-tour/releases/tag/v0.1.2
[0.1.1]: https://github.com/SuryanshBVerma/agent-tour/releases/tag/v0.1.1
[0.1.0]: https://github.com/SuryanshBVerma/agent-tour/releases/tag/v0.1.0
