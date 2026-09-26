import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { BaseResolution, BaseResolver, GitService, sameFilePath } from "../src/gitService";
import { SAMPLE_TOUR, WORKSPACE_DIR, api, resetEditor, useSampleTour } from "./helpers";

const log = vscode.window.createOutputChannel("Agent Tour Test", { log: true });

/** Stands in for a real repository so the diff path is deterministic in tests. */
class FakeResolver implements BaseResolver {
  constructor(private readonly result: BaseResolution) {}

  resolveBase(): Promise<BaseResolution> {
    return Promise.resolve(this.result);
  }
}

const workingUri = () => vscode.Uri.file(path.join(WORKSPACE_DIR, SAMPLE_TOUR.steps[0].file));

function diffTabFor(uri: vscode.Uri): boolean {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => tab.input instanceof vscode.TabInputTextDiff && sameFilePath(tab.input.modified, uri)),
  );
}

describe("Diff view", () => {
  beforeEach(useSampleTour);
  afterEach(async () => {
    (await api()).player.setBaseResolver(new GitService(log));
    await resetEditor();
  });

  it("opens a diff against the base ref and spotlights the modified side", async () => {
    const { player, store } = await api();
    const base = vscode.Uri.file(path.join(WORKSPACE_DIR, "src", "router.ts"));
    player.setBaseResolver(new FakeResolver({ kind: "ok", left: base }));
    const loaded = store.get(SAMPLE_TOUR.id)!;
    await player.start(loaded.tour, loaded.folder);

    await player.toggleDiff();
    assert.strictEqual(player.snapshot().diffMode, true);
    assert.ok(diffTabFor(workingUri()), "no diff tab was opened");

    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "no active editor after the diff opened");
    assert.ok((player.snapshot().decorated[editor.document.uri.path] ?? 0) > 0, "modified side not decorated");
  });

  it("stays navigable and falls back to the editor when there is no base", async () => {
    const { player, store } = await api();
    player.setBaseResolver(new FakeResolver({ kind: "unavailable", reason: "no repository" }));
    const loaded = store.get(SAMPLE_TOUR.id)!;
    await player.start(loaded.tour, loaded.folder);

    await player.toggleDiff();
    assert.strictEqual(player.snapshot().diffMode, true);
    assert.ok(!diffTabFor(workingUri()), "a diff tab was opened without a base");
    assert.ok((player.snapshot().decorated[workingUri().path] ?? 0) > 0, "step not spotlighted in the fallback editor");

    await player.next();
    assert.strictEqual(player.snapshot().index, 1);
    assert.strictEqual(player.snapshot().status, "playing");
  });

  it("returns to the spotlighted editor when toggled off", async () => {
    const { player, store } = await api();
    player.setBaseResolver(new FakeResolver({ kind: "ok", left: workingUri() }));
    const loaded = store.get(SAMPLE_TOUR.id)!;
    await player.start(loaded.tour, loaded.folder);

    await player.toggleDiff();
    assert.strictEqual(player.snapshot().diffMode, true);
    await player.toggleDiff();
    assert.strictEqual(player.snapshot().diffMode, false);
    assert.ok((player.snapshot().decorated[workingUri().path] ?? 0) > 0, "step not spotlighted after toggling off");
  });
});
