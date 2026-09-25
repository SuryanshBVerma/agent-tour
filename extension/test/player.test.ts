import * as assert from "assert";
import * as vscode from "vscode";
import { SAMPLE_ID, SAMPLE_TOUR, api, resetEditor } from "./helpers";

async function hoverText(uri: vscode.Uri, position: vscode.Position): Promise<string> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    uri,
    position,
  );
  return hovers
    .flatMap((hover) => hover.contents)
    .map((content) => (typeof content === "string" ? content : content.value))
    .join("\n");
}

const start = () => vscode.commands.executeCommand("agentTour.start", SAMPLE_ID);

describe("TourPlayer", () => {
  afterEach(resetEditor);

  it("walks every step, opening the right file with anchors matching", async () => {
    const { player } = await api();
    await start();

    for (let i = 0; i < SAMPLE_TOUR.steps.length; i++) {
      const step = SAMPLE_TOUR.steps[i];
      const snapshot = player.snapshot();
      assert.strictEqual(snapshot.status, "playing");
      assert.strictEqual(snapshot.index, i);
      assert.strictEqual(snapshot.stepStatus, "exact", `anchor for step ${i + 1}`);

      const editor = vscode.window.activeTextEditor;
      assert.ok(editor, "no active editor");
      assert.ok(editor.document.uri.path.endsWith(step.file), `step ${i + 1} opened ${editor.document.uri.path}`);
      assert.strictEqual(editor.selection.active.line, step.range.start - 1);
      assert.ok((snapshot.decorated[editor.document.uri.path] ?? 0) > 0, `step ${i + 1} not decorated`);

      if (i < SAMPLE_TOUR.steps.length - 1) {
        await vscode.commands.executeCommand("agentTour.next");
      }
    }

    await vscode.commands.executeCommand("agentTour.next");
    const ended = player.snapshot();
    assert.strictEqual(ended.status, "ended");
    assert.deepStrictEqual(ended.decorated, {}, "decorations left after finishing");
  });

  it("serves the card only inside the current step while active", async () => {
    const { player } = await api();
    await start();
    const uri = vscode.window.activeTextEditor!.document.uri;
    const step = SAMPLE_TOUR.steps[0];

    const inside = await hoverText(uri, new vscode.Position(step.range.start - 1, 0));
    assert.ok(inside.includes(`Step 1 of ${SAMPLE_TOUR.steps.length}`), inside);
    assert.ok(inside.includes(step.title));

    const outside = await hoverText(uri, new vscode.Position(0, 0));
    assert.ok(!outside.includes("Step 1 of"), "card leaked outside the step");

    await vscode.commands.executeCommand("agentTour.stop");
    assert.strictEqual(player.snapshot().status, "idle");
    const afterStop = await hoverText(uri, new vscode.Position(step.range.start - 1, 0));
    assert.ok(!afterStop.includes("Step 1 of"), "card still served after stop");
  });

  it("navigates back across files and ignores previous on step 1", async () => {
    const { player } = await api();
    await start();
    await vscode.commands.executeCommand("agentTour.previous");
    assert.strictEqual(player.snapshot().index, 0);

    await player.goto(3);
    assert.ok(vscode.window.activeTextEditor!.document.uri.path.endsWith("src/router.ts"));
    await vscode.commands.executeCommand("agentTour.previous");
    assert.strictEqual(player.snapshot().index, 2);
    assert.ok(vscode.window.activeTextEditor!.document.uri.path.endsWith("src/middleware/rateLimit.ts"));
  });

  it("keeps the latest step when navigation is triggered rapidly", async () => {
    const { player } = await api();
    await start();
    await Promise.all([
      vscode.commands.executeCommand("agentTour.next"),
      vscode.commands.executeCommand("agentTour.next"),
      vscode.commands.executeCommand("agentTour.next"),
    ]);
    assert.strictEqual(player.snapshot().index, 3);
    assert.ok(vscode.window.activeTextEditor!.document.uri.path.endsWith(SAMPLE_TOUR.steps[3].file));
  });

  it("keeps a navigation made while start() is still in flight", async () => {
    // Regression: start() used to await setContext before claiming its navigation, so
    // this goto(2) was overwritten by the delayed goto(0).
    const { player, store } = await api();
    const loaded = store.get(SAMPLE_ID)!;
    const starting = player.start(loaded.tour, loaded.folder);
    const jumping = player.goto(2);
    await Promise.all([starting, jumping]);
    assert.strictEqual(player.snapshot().index, 2);
  });

  it("removes decorations from the previous file on a cross-file step", async () => {
    const { player } = await api();
    await start();
    await player.goto(2);
    const rateLimit = vscode.window.activeTextEditor!.document;
    await player.goto(3);
    // Keep the previous file visible beside the new one so stale decorations would show.
    await vscode.window.showTextDocument(rateLimit, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    const decorated = player.snapshot().decorated;
    assert.strictEqual(decorated[rateLimit.uri.path], undefined, JSON.stringify(decorated));
  });

  it("redraws after the step file is closed and reopened, and cleans up on stop", async () => {
    const { player } = await api();
    await start();
    await player.goto(1);
    const uri = vscode.window.activeTextEditor!.document.uri;

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    assert.deepStrictEqual(player.snapshot().decorated, {});

    await vscode.window.showTextDocument(uri);
    assert.ok((player.snapshot().decorated[uri.path] ?? 0) > 0, "not redrawn after reopen");

    await vscode.commands.executeCommand("agentTour.stop");
    assert.deepStrictEqual(player.snapshot().decorated, {}, "decorations left after stop");
  });

  it("clears the old tour when a new start replaces it", async () => {
    const { player } = await api();
    await start();
    await player.goto(4);
    await start();
    const snapshot = player.snapshot();
    assert.strictEqual(snapshot.index, 0);
    assert.deepStrictEqual(Object.keys(snapshot.decorated).length, 1, JSON.stringify(snapshot.decorated));
  });
});
