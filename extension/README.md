# Agent Tour

**Your agent changed a dozen files. Don't read the diff: take the tour.**

Agent Tour turns a coding agent's change into a guided tour that plays in your real editor.
Each step spotlights the lines that matter, dims everything else, and explains what changed,
why it was done that way, and what to watch for.

![Agent Tour: a spotlighted step with its explanation card](https://raw.githubusercontent.com/SuryanshBVerma/agent-tour/main/docs/assets/preview.png)

## How it works
1. Your agent finishes a large change.
2. The bundled **code-tour skill** has it order the change as a story, write a step for each
   part that matters, and check every step against the real files.
3. A **Start Tour** notification appears, and you step through the change right in the editor.

Nothing is written to your repository: tours live in a temp folder, one per workspace, and
each new tour replaces the last.

## The skill is included
Installing this extension also gives **GitHub Copilot Chat** the `code-tour` skill, so there's
nothing else to set up. Copilot makes a tour on its own after a large change it drove, or
whenever you ask: *"give me a tour of what you changed"*.

Using **Claude Code** or **Copilot CLI**? Install the same skill as a plugin from the
project's repository.

Claude Code (inside a session):

```
/plugin marketplace add SuryanshBVerma/agent-tour
/plugin install code-tour@agent-tour
```

Copilot CLI:

```
copilot plugin marketplace add SuryanshBVerma/agent-tour
copilot plugin install code-tour@agent-tour
```

The skill's validator needs **Node.js 18 or later** on your `PATH`.

## In the editor
| Key | Action |
|---|---|
| `Alt+]` / `Alt+[` | Next / previous step |
| `Alt+H` | Show the step card again |
| `Alt+D` | Show the step as a side-by-side diff against the change's starting point |
| `Esc` | Stop the tour |

Steps are colored by meaning: **green** for a change, **blue** for context, **amber** for a
decision that needs your judgement, **red** for a risk. If code moves after the tour was
written, the step follows it; if the code is gone, the step is marked stale instead of
highlighting the wrong lines.

The tour is also listed under **Explorer → Agent Tours**.

## Settings
| Setting | Default | |
|---|---|---|
| `agentTour.autoStart` | `prompt` | `off`, `prompt` or `on` |
| `agentTour.cardStyle` | `inline` | `inline` (stays open) or `hover` |
| `agentTour.dimMode` | `opacity` | `opacity`, `wash` or `off` |
| `agentTour.dimOpacity` | `0.35` | How dim code outside the step is |

## Security and privacy
Tours are treated as untrusted input: they can only open files inside your workspace, card
text can't run commands or load images, and nothing starts automatically in untrusted
workspaces. No network access, no telemetry.

[Documentation, issues and source](https://github.com/SuryanshBVerma/agent-tour) · MIT license
