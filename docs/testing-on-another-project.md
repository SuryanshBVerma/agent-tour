# Testing Agent Tour on Another Project

This guide is for trying the extension and the `code-tour` skill on a real repository.

## 1. Build and install
```bash
cd D:/Projects/code-tour/extension && npm run package
```

```bash
code --install-extension D:/Projects/code-tour/extension/agent-tour.vsix
```

Reload VS Code afterwards. To remove it later:

```bash
code --uninstall-extension trivium.agent-tour
```

To pick up changes made here, rebuild the package and reinstall it (`--force` overwrites
the same version).

## 2. Get a tour into the project
Tours live in `<project>/.agent-tours/<id>.json`. You'll probably want to add `.agent-tours/`
to that project's `.gitignore`.

Install the `code-tour` skill so Claude Code writes and validates tours itself. Choose one:

- **For all your projects** (user level):

```bash
mkdir -p ~/.claude/skills && cp -r D:/Projects/code-tour/skill/code-tour ~/.claude/skills/
```

- **For one project** (can be committed so the team gets it): copy the folder to
  `<project>/.claude/skills/code-tour/` instead.

To update it later, copy it again. The folder is self-contained (`SKILL.md`, the bundled
validator, the schema and an example), and the validator needs only `node` >= 18.

Then, in the other project, either let Claude Code use it after a multi-file change, or ask
for one directly ("give me a tour of what you changed"). Asking directly also starts it,
via `code --open-url`.

The installed extension gives schema completion and error squiggles when you open the tour
file in VS Code. Invalid files show up in **Explorer → Agent Tours** with their errors.

## 3. Play it
- **Auto-start:** with the default `agentTour.autoStart: "prompt"`, a "Start Tour"
  notification appears when the file is written.
- **Manually:** run **Agent Tour: Start Tour...**, or click a step in **Explorer → Agent Tours**.
- **By link:** `code --open-url "vscode://trivium.agent-tour/start?id=<id>"`. This is Phase 0
  manual check 10; the installed extension is the setup that check is meant for.

Keys while a tour plays: `Alt+]` next, `Alt+[` previous, `Alt+H` show the card again, `Esc` stop.
The log is in **Output → Agent Tour**.

## 4. What to note
- Did the tour order and descriptions help, compared with reading the diff?
- Any step highlighting the wrong lines, marked stale, or reported as a missing file?
- Card problems: not appearing, closing too easily, crowded by language hovers.
- Dimming: readable in your theme? (Try `agentTour.dimMode: "wash"` if not.)
- Keybinding conflicts in your setup.

Notes like these feed straight into Phase 3, which is mostly about tour quality.
