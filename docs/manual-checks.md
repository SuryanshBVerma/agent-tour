# Manual Checks: Phase 2

These are visual and interactive checks the automated tests can't make. Run the extension with
F5 → **Run Agent Tour (sample workspace)**. The Phase 0 checks are in `phase0-spike.md`.

| # | Check | How | Result |
|---|---|---|---|
| 1 | Agent Tours view appears in the Explorer, listing the sample tour and 4 invalid files | Open the Explorer | |
| 2 | Clicking a step starts the tour at that step; clicking another jumps | Click step 4, then step 2 | |
| 3 | Current step is marked and selected in the tree while the tour plays | Use Alt+] with the view open | |
| 4 | Invalid files show their errors on hover and open on click | Hover and click `invalid-schema.json` | |
| 5 | Relocated step: card says "moved N lines", and the highlight lands on the right code | Add 3 blank lines at the top of `rateLimit.ts`, then start the tour | |
| 6 | Stale step: dashed outline, grey badge, no dimming, warning in the card and status bar | Rename `rateLimiter(` to `limiter(` in `rateLimit.ts`, then start the tour | |
| 7 | Missing file: warning message, no highlight left behind, Next continues | Temporarily rename `src/router.ts`, then step to step 4 | |
| 8 | Untrusted workspace: `"agentTour.autoStart": "on"` in workspace settings is ignored | Open the sample workspace in Restricted Mode, add the setting, then write a tour file | |

Revert the fixture edits from checks 5–7 afterwards (`git checkout -- extension/test/fixtures`).

## v0.1.0 additions

| # | Check | How | Result |
|---|---|---|---|
| 9 | Kind badge in the card is colored (green change, blue context, amber decision, red risk) | Set `agentTour.cardStyle` to `"hover"`, step through all 4 kinds, light and dark theme | |
| 10 | Inline card appears above the step and stays open when clicking elsewhere | Default settings; click around the file | |
| 11 | Inline card title bar ‹ › × work; Alt+H re-opens a collapsed card | Collapse the card, press Alt+H | |
| 12 | Nothing is written into the repository | Publish a tour, run `git status` in the project | |
| 13 | A new tour replaces the previous one | Ask the agent for two tours in a row; Agent Tours lists one | |

## v0.1.2 additions (diff view)
Run these in a real Git repository (the sample workspace is not one), with a tour whose
`baseRef` is a commit behind the working tree.

| # | Check | How | Result |
|---|---|---|---|
| 14 | Alt+D opens a two-column diff of the step against `baseRef` | Start a tour, press Alt+D | |
| 15 | The modified (right) side is spotlighted and the step card behaves as usual | Look at the right column and the card | |
| 16 | The status-bar diff icon reflects the state, and clicking it toggles | Toggle on and off from the status bar | |
| 17 | Diff mode is sticky across Next/Previous and off by default | Step forward twice without pressing Alt+D again | |
| 18 | Alt+D again, or Stop, returns to the spotlighted editor with no decorations left | Toggle off, then stop | |
| 19 | An added file (no version at `baseRef`) falls back to the editor with one notice | Tour a newly added file, press Alt+D | |
| 20 | A non-repository workspace falls back with one notice and stays navigable | Open a folder that is not a Git repo, press Alt+D | |

