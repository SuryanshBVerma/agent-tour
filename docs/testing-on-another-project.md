# Testing an Unreleased Build on Another Project

Users install Agent Tour from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SuryanshBVerma.agent-tour)
(see the README). This guide is for trying a **local build** of this repository on a real
project before it's released.

## 1. Build and install the extension
```bash
cd D:/Projects/code-tour/extension && npm run package
```

```bash
code --install-extension D:/Projects/code-tour/extension/agent-tour.vsix --force
```

`--force` replaces whatever version is installed, including the Marketplace one; reinstall
from the Marketplace afterwards to go back. Reload VS Code (**Developer: Reload Window**).

The build includes the `code-tour` skill, so **Copilot Chat needs no other setup**. If you
ever copied the skill into `~/.copilot/skills/` by hand, delete that copy so Copilot doesn't
see the skill twice. Check it's loaded in Copilot's **Configure Skills** list.

**VS Code profiles:** `--install-extension` installs into the **Default** profile only.
If the project opens in another profile (the gear icon at the bottom left shows which),
add `--profile "<name>"`. Otherwise start links fail with
*"The extension 'SuryanshBVerma.agent-tour' cannot be installed because it was not found"*.

## 2. Claude Code or Copilot CLI: load the plugin from this folder
Register this repository folder as a local plugin marketplace, then install the plugin.
Claude Code reads the files directly, so edits here take effect in the next session (or
after `/reload-plugins`):

```
/plugin marketplace add D:/Projects/code-tour
/plugin install code-tour@agent-tour
```

Copilot CLI: `copilot plugin marketplace add D:/Projects/code-tour`, then install
`code-tour@agent-tour`.

## 3. Get a tour
After a large multi-file change the agent drove itself, it publishes a tour on its own. For
anything else, ask: *"give me a tour of what you changed"*. Tours never go into the repository:
the skill publishes each one to a per-user temp folder (`<temp>/agent-tours-<user>/`), one slot
per workspace, and a new tour replaces the previous one.

## 4. Play it
- **Auto-start:** with the default `agentTour.autoStart: "prompt"`, a **Start Tour**
  notification appears when the tour is published.
- **Manually:** run **Agent Tour: Start Tour...**, or click a step in **Explorer → Agent Tours**.
- **By link:** `code --open-url "vscode://SuryanshBVerma.agent-tour/start?id=<id>"`.

Keys while a tour plays: `Alt+]` next, `Alt+[` previous, `Alt+H` show the card again, `Alt+D`
side-by-side diff, `Esc` stop. The log is in **Output → Agent Tour**.

## 5. What to note
- Did the tour order and descriptions help, compared with reading the diff?
- Any step highlighting the wrong lines, marked stale, or reported as a missing file?
- Did the agent make a tour when it shouldn't have, or skip one when it should?
- Card problems: not appearing, closing too easily.
- Dimming: readable in your theme? (Try `agentTour.dimMode: "wash"` if not.)
- Keybinding conflicts in your setup.
