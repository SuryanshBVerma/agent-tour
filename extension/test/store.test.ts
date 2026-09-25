import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { SAMPLE_ID, SAMPLE_TOUR, TOURS_DIR, api, resetEditor, setAutoStart, waitFor } from "./helpers";

const WATCH_ID = "watch-test";
const watchFile = path.join(TOURS_DIR, `${WATCH_ID}.json`);

function writeWatchTour(title = "Watcher test tour"): void {
  fs.writeFileSync(watchFile, JSON.stringify({ ...SAMPLE_TOUR, id: WATCH_ID, title }, null, 2));
}

describe("TourStore", () => {
  it("loads valid tours and keeps invalid ones with errors", async () => {
    const { store } = await api();
    await store.reload();
    assert.deepStrictEqual(store.all().map((t) => t.tour.id), [SAMPLE_ID]);
    const invalidNames = store.invalidTours().map((t) => path.basename(t.uri.fsPath)).sort();
    assert.deepStrictEqual(invalidNames, [
      "invalid-id-mismatch.json",
      "invalid-json.json",
      "invalid-schema.json",
      "invalid-traversal.json",
    ]);
    for (const invalid of store.invalidTours()) {
      assert.ok(invalid.errors.length > 0);
    }
  });
});

describe("Auto-start and triggers", () => {
  afterEach(async () => {
    await setAutoStart(undefined);
    await resetEditor();
    if (fs.existsSync(watchFile)) {
      fs.rmSync(watchFile);
    }
    const { store } = await api();
    await waitFor(() => !store.get(WATCH_ID), 5000, "watch tour removal");
  });

  it("auto-starts a newly written tour within 2 s when autoStart is on", async () => {
    const { player, store } = await api();
    await setAutoStart("on");
    writeWatchTour();
    const elapsed = await waitFor(
      () => player.snapshot().tourId === WATCH_ID && player.snapshot().status === "playing",
      2000,
      "auto-start",
    );
    assert.ok(store.get(WATCH_ID));
    console.log(`      auto-start latency: ${elapsed} ms`);
  });

  it("reloads the playing tour in place when its file changes", async () => {
    const { player, store } = await api();
    await setAutoStart("on");
    writeWatchTour();
    await waitFor(() => player.snapshot().tourId === WATCH_ID, 2000, "auto-start");
    await player.goto(2);

    writeWatchTour("Renamed by agent");
    await waitFor(() => store.get(WATCH_ID)?.tour.title === "Renamed by agent", 2000, "reload");
    const snapshot = player.snapshot();
    assert.strictEqual(snapshot.status, "playing");
    assert.strictEqual(snapshot.index, 2);
  });

  it("stops the tour when its file is deleted", async () => {
    const { player } = await api();
    await setAutoStart("on");
    writeWatchTour();
    await waitFor(() => player.snapshot().tourId === WATCH_ID, 2000, "auto-start");
    fs.rmSync(watchFile);
    await waitFor(() => player.snapshot().status === "idle", 2000, "stop after delete");
    assert.deepStrictEqual(player.snapshot().decorated, {});
  });

  it("does not start anything when autoStart is off", async () => {
    const { player, store } = await api();
    await setAutoStart("off");
    writeWatchTour();
    await waitFor(() => !!store.get(WATCH_ID), 2000, "store to see the file");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(player.snapshot().status, "idle");
  });

  it("starts a tour from a valid start URI and ignores invalid ones", async () => {
    const { player, trigger } = await api();
    await trigger.handleUri(vscode.Uri.parse("vscode://trivium.agent-tour/start?id=../x"));
    assert.strictEqual(player.snapshot().status, "idle");

    await trigger.handleUri(vscode.Uri.parse(`vscode://trivium.agent-tour/start?id=${SAMPLE_ID}`));
    assert.strictEqual(player.snapshot().tourId, SAMPLE_ID);
  });

  it("finds a tour written just before the start URI arrives", async () => {
    const { player, trigger } = await api();
    await setAutoStart("off");
    writeWatchTour();
    // No waiting for the watcher: find() must read the file directly.
    await trigger.handleUri(vscode.Uri.parse(`vscode://trivium.agent-tour/start?id=${WATCH_ID}`));
    assert.strictEqual(player.snapshot().tourId, WATCH_ID);
  });
});
