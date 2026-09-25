# Phase 0 Spike: Checklist and Results

Goal: decide go/no-go for the native-editor approach (plan section 6, Phase 0).
The spike originally hardcoded its 5-step tour. Since Phase 1 the same tour is loaded from
`extension/test/fixtures/tours/2026-09-25-rate-limiting.json` (published to the sample workspace's temp slot by the F5 launch config). It covers all four step kinds, two same-file
step changes, and a cross-file jump.

## How to run
1. Open `D:\Projects\code-tour` in VS Code.
2. Press F5 and choose **Run Agent Tour (sample workspace)**. A second window, the
   Extension Development Host, opens with the fixture workspace.
3. In that window, run **Agent Tour: Start Tour...** from the Command Palette and pick "Add rate limiting to public API".
4. Open **Output → Agent Tour** to see the log (step changes, URI receipt timestamps,
   anchor warnings).

Automated tests: `cd extension && npm test` (downloads VS Code 1.90.0 into
`extension/.vscode-test/` on first run).

## Automated checks (26 tests at the end of Phase 0; the Phase 1 suite covers more)
| Check | Test |
|---|---|
| Every step opens the right file with the cursor on its start line | `player.test.ts` |
| All spike anchors match their declared lines | `player.test.ts` |
| Card is served only inside the current step, and not after stop | `player.test.ts` |
| Previous/next across files; previous is a no-op on step 1; finish → ended | `player.test.ts` |
| Rapid repeated Next ends on the latest step | `player.test.ts` |
| Card trusts only `agentTour.previous/next/stop`; HTML off; images neutralized | `unit.test.ts` |
| Path traversal and absolute paths rejected | `unit.test.ts` |
| URI parsing accepts only `/start` with exactly one valid id | `unit.test.ts` |
| `dimOpacity` clamped, so workspace settings cannot inject CSS | `unit.test.ts` |

## Manual checks (need a human; fill in the Result column)
| # | Check | How | Result |
|---|---|---|---|
| 1 | Target tint, left border, gutter number and overview-ruler mark look right | Step through; try a light theme (Light Modern) and a dark theme (Dark Modern) | |
| 2 | Opacity dimming works in light and dark themes | Default `agentTour.dimMode: "opacity"`; also try `dimOpacity` 0.2 and 0.6 (applies live) | |
| 3 | Wash fallback is acceptable | Set `agentTour.dimMode` to `"wash"` | |
| 4 | Card appears reliably at the target on every step, including cross-file jumps | Step through 2–3 times with Alt+] / Alt+[ | |
| 5 | Card links Previous / Next / Stop work (restricted `isTrusted`) | Click them in the card | |
| 6 | Language hovers don't crowd the card | Watch steps 1 and 4 (start lines begin with identifiers) | |
| 7 | Keybindings: Alt+] next, Alt+[ previous, Alt+H reshow card, Esc stop | Also confirm Alt+H does not open the Help menu | |
| 8 | Status bar controls stay visible and work after the hover closes | Click ‹ label › × in the status bar | |
| 9 | No decorations left after Stop, after Finish, or after closing and reopening a file mid-tour | Close `rateLimit.ts` during step 2, reopen it, then stop | |
| 10 | `code --open-url` reaches the URI handler | With the dev host open, run the command below in a terminal and check the log for `URI received` | |

Command for check 10:

```bash
code --open-url "vscode://agent-tour.agent-tour/start?id=2026-09-25-rate-limiting"
```

Record how long delivery takes (compare the log timestamp with when you pressed Enter),
and whether it reaches the dev host window or the regular one. If it's unreliable, the
file watcher becomes the primary trigger (plan section 2, step 4).

## Decision
Go / No-go: _pending the manual checks above._
