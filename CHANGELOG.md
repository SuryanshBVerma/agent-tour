# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

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
- `vscode://trivium.agent-tour/start?id=<id>` start links.
- Security: workspace confinement including symlinks, untrusted card content, a private tour
  folder, Workspace Trust support, and no network access or telemetry.

### Skill (`code-tour`)
- `SKILL.md`: when to make a tour, collecting changes, narrative ordering, step and kind
  rules, the What/Why/Watch-for pattern, and hand-over.
- `validate-tour.mjs` (runs with plain Node.js 18+): `--where` prints the draft path;
  validation checks the schema, files, ranges, anchors, overlaps and quality; `--publish`
  replaces the workspace's tour atomically.

[0.1.0]: https://github.com/SuryanshBVerma/agent-tour/releases/tag/v0.1.0
