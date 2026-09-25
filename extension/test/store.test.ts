import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { relativeLeavesRoot } from "../src/pathRules";
import { tourRoot, tourSlotPath, workspaceKey } from "../src/tourLocation";
import {
  LATENCY_BUDGET_MS,
  SAMPLE_ID,
  SAMPLE_TOUR,
  SLOT_PATH,
  TOUR_FIXTURES,
  WATCH_TIMEOUT_MS,
  WORKSPACE_DIR,
  api,
  clearSlot,
  publish,
  resetEditor,
  setAutoStart,
  waitFor,
} from "./helpers";

const WATCH_ID = "watch-test";

function watchTour(title = "Watcher test tour") {
  return { ...SAMPLE_TOUR, id: WATCH_ID, title };
}

describe("Tour location", () => {
  it("keeps tours outside the repository, one slot per workspace", () => {
    const relative = path.relative(WORKSPACE_DIR, SLOT_PATH);
    assert.ok(relativeLeavesRoot(relative) || path.isAbsolute(relative), `slot ${SLOT_PATH} is inside the workspace`);
    assert.strictEqual(path.dirname(SLOT_PATH), tourRoot());
    assert.ok(tourRoot().toLowerCase().startsWith(fs.realpathSync.native(os.tmpdir()).toLowerCase()));
    assert.strictEqual(path.basename(SLOT_PATH), `${workspaceKey(WORKSPACE_DIR)}.json`);
    assert.notStrictEqual(workspaceKey(WORKSPACE_DIR), workspaceKey(path.dirname(WORKSPACE_DIR)));
  });

  it("derives the same key for equivalent spellings of the workspace path", () => {
    assert.strictEqual(workspaceKey(WORKSPACE_DIR + path.sep), workspaceKey(WORKSPACE_DIR));
    if (process.platform === "win32") {
      assert.strictEqual(workspaceKey(WORKSPACE_DIR.toUpperCase()), workspaceKey(WORKSPACE_DIR.toLowerCase()));
    }
  });
});

describe("TourStore", () => {
  afterEach(async () => {
    clearSlot();
    await (await api()).store.reload();
  });

  it("loads the tour published for the open workspace", async () => {
    const { store } = await api();
    publish(SAMPLE_TOUR);
    await store.reload();
    assert.deepStrictEqual(store.all().map((t) => t.tour.id), [SAMPLE_ID]);
    assert.strictEqual(store.get(SAMPLE_ID)!.folder.fsPath.toLowerCase(), WORKSPACE_DIR.toLowerCase());
  });

  it("ignores tours published for other workspaces", async () => {
    const { store } = await api();
    const otherSlot = tourSlotPath(path.join(os.tmpdir(), "some-other-workspace"));
    fs.writeFileSync(otherSlot, JSON.stringify({ ...SAMPLE_TOUR, id: "other-workspace" }));
    try {
      await store.reload();
      assert.strictEqual(store.get("other-workspace"), undefined);
    } finally {
      fs.rmSync(otherSlot, { force: true });
    }
  });

  for (const name of ["invalid-schema", "invalid-traversal", "invalid-json"]) {
    it(`keeps an invalid slot (${name}) with its errors`, async () => {
      const { store } = await api();
      publish(fs.readFileSync(path.join(TOUR_FIXTURES, `${name}.json`), "utf8"));
      await store.reload();
      assert.strictEqual(store.all().length, 0);
      const [invalid] = store.invalidTours();
      assert.ok(invalid && invalid.errors.length > 0, JSON.stringify(store.invalidTours()));
    });
  }

  it("treats a late watcher event for a deleted slot as a removal, not an invalid tour", async () => {
    // Regression: a change event delivered after deletion used to record the missing
    // file as invalid. Drive the private loader directly to make the race deterministic.
    const { store } = await api();
    const folder = vscode.workspace.workspaceFolders![0].uri;
    clearSlot();
    await (store as unknown as { load(u: vscode.Uri, f: vscode.Uri, w: boolean): Promise<unknown> }).load(
      vscode.Uri.file(SLOT_PATH),
      folder,
      true,
    );
    assert.strictEqual(store.invalidTours().length, 0);
  });
});

describe("Auto-start and triggers", () => {
  afterEach(async () => {
    await setAutoStart(undefined);
    await resetEditor();
    clearSlot();
    const { store } = await api();
    await waitFor(() => !store.get(WATCH_ID), WATCH_TIMEOUT_MS, "watch tour removal");
  });

  it("auto-starts a newly published tour within the latency budget when autoStart is on", async () => {
    const { player, store } = await api();
    await setAutoStart("on");
    publish(watchTour());
    const elapsed = await waitFor(
      () => player.snapshot().tourId === WATCH_ID && player.snapshot().status === "playing",
      LATENCY_BUDGET_MS,
      "auto-start",
      // Distinguishes "watcher never delivered the event" from "seen but not started".
      () => `store has tour: ${!!store.get(WATCH_ID)}, player: ${JSON.stringify(player.snapshot())}`,
    );
    console.log(`      auto-start latency: ${elapsed} ms`);
  });

  it("sees a tour published immediately after the watcher is recreated", async () => {
    const { store } = await api();
    await store.reload();
    publish(watchTour());
    await waitFor(() => !!store.get(WATCH_ID), WATCH_TIMEOUT_MS, "store to see the tour");
  });

  it("replaces the previous tour when a new one is published for the same workspace", async () => {
    const { store } = await api();
    publish(SAMPLE_TOUR);
    await store.reload();
    publish(watchTour());
    await waitFor(() => !!store.get(WATCH_ID), WATCH_TIMEOUT_MS, "new tour");
    assert.strictEqual(store.get(SAMPLE_ID), undefined, "old tour still listed");
    assert.deepStrictEqual(store.all().map((t) => t.tour.id), [WATCH_ID]);
  });

  it("reloads the playing tour in place when it is republished", async () => {
    const { player, store } = await api();
    await setAutoStart("on");
    publish(watchTour());
    await waitFor(() => player.snapshot().tourId === WATCH_ID, WATCH_TIMEOUT_MS, "auto-start");
    await player.goto(2);

    publish(watchTour("Renamed by agent"));
    await waitFor(() => store.get(WATCH_ID)?.tour.title === "Renamed by agent", WATCH_TIMEOUT_MS, "reload");
    const snapshot = player.snapshot();
    assert.strictEqual(snapshot.status, "playing");
    assert.strictEqual(snapshot.index, 2);
  });

  it("stops the tour when its slot is deleted", async () => {
    const { player } = await api();
    await setAutoStart("on");
    publish(watchTour());
    await waitFor(() => player.snapshot().tourId === WATCH_ID, WATCH_TIMEOUT_MS, "auto-start");
    clearSlot();
    await waitFor(() => player.snapshot().status === "idle", WATCH_TIMEOUT_MS, "stop after delete");
    assert.deepStrictEqual(player.snapshot().decorated, {});
  });

  it("does not start anything when autoStart is off", async () => {
    const { player, store } = await api();
    await setAutoStart("off");
    publish(watchTour());
    await waitFor(() => !!store.get(WATCH_ID), WATCH_TIMEOUT_MS, "store to see the tour");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(player.snapshot().status, "idle");
  });

  it("starts a tour from a valid start URI and ignores invalid ones", async () => {
    const { player, trigger } = await api();
    await setAutoStart("off");
    publish(watchTour());
    await trigger.handleUri(vscode.Uri.parse("vscode://agent-tour.agent-tour/start?id=../x"));
    assert.strictEqual(player.snapshot().status, "idle", `after invalid URI: ${JSON.stringify(player.snapshot())}`);

    await trigger.handleUri(vscode.Uri.parse(`vscode://agent-tour.agent-tour/start?id=${WATCH_ID}`));
    const { store } = await api();
    assert.strictEqual(
      player.snapshot().tourId,
      WATCH_ID,
      `after valid URI: ${JSON.stringify(player.snapshot())}; store: ${JSON.stringify(store.all().map((t) => t.tour.id))}`,
    );
  });

  it("finds a tour published just before the start URI arrives", async () => {
    const { player, trigger } = await api();
    await setAutoStart("off");
    publish(watchTour());
    // No waiting for the watcher: find() must read the slot directly.
    await trigger.handleUri(vscode.Uri.parse(`vscode://agent-tour.agent-tour/start?id=${WATCH_ID}`));
    assert.strictEqual(player.snapshot().tourId, WATCH_ID);
  });
});
