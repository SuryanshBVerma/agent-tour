import * as assert from "assert";
import * as vscode from "vscode";
import type { AgentTourApi } from "../src/extension";
import { SPIKE_TOUR } from "../src/spikeTour";

async function api(): Promise<AgentTourApi> {
  const extension = vscode.extensions.getExtension<AgentTourApi>("agent-tour.agent-tour");
  assert.ok(extension, "extension not found");
  return extension.activate();
}

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

describe("TourPlayer (spike tour)", function () {
  afterEach(async () => {
    await vscode.commands.executeCommand("agentTour.stop");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  it("walks every step, opening the right file with anchors matching", async () => {
    const { player } = await api();
    await vscode.commands.executeCommand("agentTour.spike.start");

    for (let i = 0; i < SPIKE_TOUR.steps.length; i++) {
      const step = SPIKE_TOUR.steps[i];
      const snapshot = player.snapshot();
      assert.strictEqual(snapshot.status, "playing");
      assert.strictEqual(snapshot.index, i);
      assert.strictEqual(snapshot.anchorMatched, true, `anchor for step ${i + 1}`);

      const editor = vscode.window.activeTextEditor;
      assert.ok(editor, "no active editor");
      assert.ok(
        editor.document.uri.path.endsWith(step.file),
        `step ${i + 1} opened ${editor.document.uri.path}`,
      );
      assert.strictEqual(editor.selection.active.line, step.range.start - 1);

      if (i < SPIKE_TOUR.steps.length - 1) {
        await vscode.commands.executeCommand("agentTour.next");
      }
    }

    await vscode.commands.executeCommand("agentTour.next");
    assert.strictEqual(player.snapshot().status, "ended");
  });

  it("serves the card only inside the current step while active", async () => {
    const { player } = await api();
    await vscode.commands.executeCommand("agentTour.spike.start");
    const uri = vscode.window.activeTextEditor!.document.uri;
    const step = SPIKE_TOUR.steps[0];

    const inside = await hoverText(uri, new vscode.Position(step.range.start - 1, 0));
    assert.ok(inside.includes(`Step 1 of ${SPIKE_TOUR.steps.length}`), inside);
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
    await vscode.commands.executeCommand("agentTour.spike.start");
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
    await vscode.commands.executeCommand("agentTour.spike.start");
    await Promise.all([
      vscode.commands.executeCommand("agentTour.next"),
      vscode.commands.executeCommand("agentTour.next"),
      vscode.commands.executeCommand("agentTour.next"),
    ]);
    const snapshot = player.snapshot();
    assert.strictEqual(snapshot.index, 3);
    assert.ok(vscode.window.activeTextEditor!.document.uri.path.endsWith(SPIKE_TOUR.steps[3].file));
  });
});
