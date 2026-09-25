import * as assert from "assert";
import * as vscode from "vscode";
import { resolveWorkspaceFile } from "../src/paths";
import { SPIKE_TOUR } from "../src/spikeTour";
import { clampOpacity } from "../src/spotlightRenderer";
import { CARD_COMMANDS, renderCard, sanitizeDescription } from "../src/stepCard";
import { parseStartUri } from "../src/triggerHandler";
import { TOUR_ID_PATTERN } from "../src/types";

describe("resolveWorkspaceFile", () => {
  const folder = vscode.Uri.file("/work/repo");

  it("accepts workspace-relative paths", () => {
    assert.strictEqual(resolveWorkspaceFile(folder, "src/a.ts")?.path, "/work/repo/src/a.ts");
    assert.strictEqual(resolveWorkspaceFile(folder, "src\\b.ts")?.path, "/work/repo/src/b.ts");
  });

  for (const bad of ["", "/etc/passwd", "C:\\Windows\\win.ini", "c:/x", "../x", "a/../../x", "a\\..\\..\\x", "a\0b"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.strictEqual(resolveWorkspaceFile(folder, bad), undefined);
    });
  }
});

describe("clampOpacity", () => {
  it("clamps numbers and ignores non-numbers so settings cannot inject CSS", () => {
    assert.strictEqual(clampOpacity(0.35), 0.35);
    assert.strictEqual(clampOpacity(5), 1);
    assert.strictEqual(clampOpacity(0), 0.05);
    assert.strictEqual(clampOpacity(Number.NaN), 0.35);
    assert.strictEqual(clampOpacity("0.5; color: red"), 0.35);
  });
});

describe("parseStartUri", () => {
  const uri = (s: string) => vscode.Uri.parse(s);

  it("returns a valid id", () => {
    assert.strictEqual(parseStartUri(uri("vscode://trivium.agent-tour/start?id=spike")), "spike");
  });

  for (const bad of [
    "vscode://trivium.agent-tour/start",
    "vscode://trivium.agent-tour/start?id=",
    "vscode://trivium.agent-tour/start?id=../etc",
    "vscode://trivium.agent-tour/start?id=Upper",
    "vscode://trivium.agent-tour/start?id=a&id=b",
    "vscode://trivium.agent-tour/open?id=spike",
  ]) {
    it(`rejects ${bad}`, () => assert.strictEqual(parseStartUri(uri(bad)), undefined));
  }
});

describe("step card", () => {
  it("trusts only this extension's commands and disables HTML", () => {
    const md = renderCard(SPIKE_TOUR, 0, false);
    assert.deepStrictEqual(md.isTrusted, { enabledCommands: [...CARD_COMMANDS] });
    assert.strictEqual(md.supportHtml, false);
  });

  it("shows no Previous on the first step and Finish on the last", () => {
    const first = renderCard(SPIKE_TOUR, 0, false).value;
    const last = renderCard(SPIKE_TOUR, SPIKE_TOUR.steps.length - 1, false).value;
    assert.ok(!first.includes("command:agentTour.previous"));
    assert.ok(first.includes(`Step 1 of ${SPIKE_TOUR.steps.length}`));
    assert.ok(last.includes("Finish"));
    assert.ok(last.includes("command:agentTour.previous"));
  });

  it("marks stale anchors", () => {
    assert.ok(renderCard(SPIKE_TOUR, 0, true).value.includes("anchor not found"));
  });

  it("neutralizes images so descriptions cannot fetch remote content", () => {
    assert.strictEqual(sanitizeDescription("see ![x](https://e.com/p.png)"), "see \\![x](https://e.com/p.png)");
  });
});

describe("spike tour", () => {
  it("has a valid id", () => assert.ok(TOUR_ID_PATTERN.test(SPIKE_TOUR.id)));
});
