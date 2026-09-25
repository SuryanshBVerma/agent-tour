import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { TourNode } from "../src/tourTree";
import type { Tour } from "../src/types";
import { SAMPLE_ID, SAMPLE_TOUR, WORKSPACE_DIR, api, resetEditor, useSampleTour } from "./helpers";

function variant(id: string, edit: (tour: Tour) => void): Tour {
  const tour = structuredClone(SAMPLE_TOUR);
  tour.id = id;
  edit(tour);
  return tour;
}

const folder = () => vscode.workspace.workspaceFolders![0].uri;

describe("Anchor resolution in the player", () => {
  afterEach(resetEditor);

  it("relocates a step whose lines shifted and spotlights the real location", async () => {
    const { player } = await api();
    const tour = variant("shifted", (t) => {
      t.steps[0].range = { start: 22, end: 38 }; // Declared 3 lines too high.
    });
    await player.start(tour, folder());
    const snapshot = player.snapshot();
    assert.strictEqual(snapshot.stepStatus, "relocated");
    assert.strictEqual(snapshot.startLine, SAMPLE_TOUR.steps[0].range.start - 1);
    assert.strictEqual(vscode.window.activeTextEditor!.selection.active.line, snapshot.startLine);
  });

  it("marks a step stale when its anchor is gone, outlining without dimming", async () => {
    const { player } = await api();
    const tour = variant("stale", (t) => {
      t.steps[0].anchor = "export function removedLongAgo(";
    });
    await player.start(tour, folder());
    const snapshot = player.snapshot();
    assert.strictEqual(snapshot.stepStatus, "stale");
    // Outline + gutter badge only: exactly 2 ranges, no dim ranges.
    const path = vscode.window.activeTextEditor!.document.uri.path;
    assert.strictEqual(snapshot.decorated[path], 2, JSON.stringify(snapshot.decorated));
  });

  it("clears the previous step and stays navigable when a step's file is missing", async () => {
    const { player } = await api();
    const tour = variant("missing-file", (t) => {
      t.steps[1].file = "src/deleted.ts";
    });
    await player.start(tour, folder());
    await vscode.commands.executeCommand("agentTour.next");
    let snapshot = player.snapshot();
    assert.strictEqual(snapshot.stepStatus, "missing");
    assert.deepStrictEqual(snapshot.decorated, {}, "previous step still highlighted");

    await vscode.commands.executeCommand("agentTour.next");
    snapshot = player.snapshot();
    assert.strictEqual(snapshot.index, 2);
    assert.strictEqual(snapshot.stepStatus, "exact");
    assert.strictEqual(player.stepStatus("missing-file", 1), "missing");
  });
});

describe("Symlinks", () => {
  const link = path.join(WORKSPACE_DIR, "linked");
  let outside: string;

  before(() => {
    fs.rmSync(link, { recursive: true, force: true }); // Left behind by a killed run.
    // Same drive as the workspace, so the relative-path check is what must catch it
    // (across drives path.relative returns an absolute path and hides a broken check).
    outside = fs.mkdtempSync(path.join(path.dirname(WORKSPACE_DIR), "outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "export const secretValue = 1;\n");
    fs.symlinkSync(outside, link, "junction");
  });

  after(async () => {
    await resetEditor();
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("refuses to open a step file that resolves outside the workspace", async () => {
    const { player } = await api();
    const tour = variant("symlink-escape", (t) => {
      t.steps[0] = { ...t.steps[0], file: "linked/secret.txt", range: { start: 1, end: 1 }, anchor: "export const secretValue" };
    });
    await player.start(tour, folder());
    assert.strictEqual(player.snapshot().stepStatus, "missing");
    const opened = vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath);
    assert.ok(!opened.some((p) => p.includes("secret.txt")), JSON.stringify(opened));
  });
});

describe("TourTree", () => {
  beforeEach(useSampleTour);
  afterEach(resetEditor);

  it("lists the workspace's current tour with its steps", async () => {
    const { tree } = await api();
    const roots = tree.getChildren();
    assert.deepStrictEqual(roots.map((n) => n.type), ["tour"]);
    const steps = tree.getChildren(roots[0]);
    assert.strictEqual(steps.length, SAMPLE_TOUR.steps.length);

    const item = tree.getTreeItem(steps[3]);
    assert.strictEqual(item.label, `4. ${SAMPLE_TOUR.steps[3].title}`);
    assert.deepStrictEqual(item.command?.arguments, [SAMPLE_ID, 3]);
    assert.strictEqual(tree.getParent(steps[3])?.type, "tour");
  });

  it("does not trust tooltip Markdown from the tour", async () => {
    const { tree } = await api();
    const [tourNode] = tree.getChildren();
    for (const node of [tourNode, ...tree.getChildren(tourNode)] as TourNode[]) {
      const tooltip = tree.getTreeItem(node).tooltip as vscode.MarkdownString;
      assert.ok(!tooltip.isTrusted, "tooltip must not be trusted");
      assert.ok(!tooltip.supportHtml, "tooltip must not render HTML");
    }
  });

  it("starts the tour at the clicked step, and jumps within it once playing", async () => {
    const { player } = await api();
    await vscode.commands.executeCommand("agentTour.goto", SAMPLE_ID, 3);
    assert.strictEqual(player.snapshot().tourId, SAMPLE_ID);
    assert.strictEqual(player.snapshot().index, 3);

    await vscode.commands.executeCommand("agentTour.goto", SAMPLE_ID, 1);
    assert.strictEqual(player.snapshot().index, 1);
  });

  it("starts from the inline action's tree node", async () => {
    const { player, tree } = await api();
    const [tourNode] = tree.getChildren();
    await vscode.commands.executeCommand("agentTour.start", tourNode);
    assert.strictEqual(player.snapshot().tourId, SAMPLE_ID);
    assert.strictEqual(player.snapshot().index, 0);
  });

  it("shows the playing tour expanded and marks the current step", async () => {
    const { tree } = await api();
    await vscode.commands.executeCommand("agentTour.goto", SAMPLE_ID, 2);
    const [tourNode] = tree.getChildren();
    assert.strictEqual(tree.getTreeItem(tourNode).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    const icon = tree.getTreeItem(tree.getChildren(tourNode)[2]).iconPath as vscode.ThemeIcon;
    assert.strictEqual(icon.id, "arrow-right");
  });
});
