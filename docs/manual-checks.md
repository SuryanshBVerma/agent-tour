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
