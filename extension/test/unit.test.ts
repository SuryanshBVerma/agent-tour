import * as assert from "assert";
import * as vscode from "vscode";
import { relativeLeavesRoot } from "../src/pathRules";
import { resolveWorkspaceFile } from "../src/paths";
import { clampOpacity } from "../src/spotlightRenderer";
import { CARD_COMMANDS, renderCard, sanitizeDescription } from "../src/stepCard";
import { parseStartUri } from "../src/triggerHandler";
import { validateTour } from "../src/tourValidation";
import { SAMPLE_ID, SAMPLE_TOUR, readFixtureTour } from "./helpers";

describe("resolveWorkspaceFile", () => {
  const folder = vscode.Uri.file("/work/repo");

  it("accepts workspace-relative paths", () => {
    assert.strictEqual(resolveWorkspaceFile(folder, "src/a.ts")?.path, "/work/repo/src/a.ts");
    assert.strictEqual(resolveWorkspaceFile(folder, "src\\b.ts")?.path, "/work/repo/src/b.ts");
  });

  it("accepts names that merely start with two dots", () => {
    assert.strictEqual(resolveWorkspaceFile(folder, "..config/a.ts")?.path, "/work/repo/..config/a.ts");
  });

  for (const bad of ["", "/etc/passwd", "C:\\Windows\\win.ini", "c:/x", "../x", "a/../../x", "a\\..\\..\\x", "a\0b"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.strictEqual(resolveWorkspaceFile(folder, bad), undefined);
    });
  }
});

describe("relativeLeavesRoot", () => {
  it("detects parent segments with either separator", () => {
    for (const out of ["..", "../x", "..\\x", "..\\..\\x"]) {
      assert.strictEqual(relativeLeavesRoot(out), true, out);
    }
  });

  it("allows names that start with two dots", () => {
    for (const inside of ["", "x", "..config", "..config/x", "..config\\x"]) {
      assert.strictEqual(relativeLeavesRoot(inside), false, inside);
    }
  });
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
    assert.strictEqual(parseStartUri(uri("vscode://agent-tour.agent-tour/start?id=spike")), "spike");
  });

  for (const bad of [
    "vscode://agent-tour.agent-tour/start",
    "vscode://agent-tour.agent-tour/start?id=",
    "vscode://agent-tour.agent-tour/start?id=../etc",
    "vscode://agent-tour.agent-tour/start?id=Upper",
    "vscode://agent-tour.agent-tour/start?id=a&id=b",
    "vscode://agent-tour.agent-tour/open?id=spike",
  ]) {
    it(`rejects ${bad}`, () => assert.strictEqual(parseStartUri(uri(bad)), undefined));
  }
});

const ZERO = new vscode.Range(0, 0, 0, 0);
const EXACT = { status: "exact", range: ZERO } as const;

describe("step card", () => {
  it("trusts only this extension's commands and disables HTML", () => {
    const md = renderCard(SAMPLE_TOUR, 0, EXACT);
    assert.deepStrictEqual(md.isTrusted, { enabledCommands: [...CARD_COMMANDS] });
    assert.strictEqual(md.supportHtml, false);
  });

  it("shows no Previous on the first step and Finish on the last", () => {
    const first = renderCard(SAMPLE_TOUR, 0, EXACT).value;
    const last = renderCard(SAMPLE_TOUR, SAMPLE_TOUR.steps.length - 1, EXACT).value;
    assert.ok(!first.includes("command:agentTour.previous"));
    assert.ok(first.includes(`Step 1 of ${SAMPLE_TOUR.steps.length}`));
    assert.ok(last.includes("Finish"));
    assert.ok(last.includes("command:agentTour.previous"));
  });

  it("marks stale and relocated steps", () => {
    assert.ok(renderCard(SAMPLE_TOUR, 0, { status: "stale", range: ZERO }).value.includes("Stale"));
    const moved = renderCard(SAMPLE_TOUR, 0, { status: "relocated", range: ZERO, delta: -3 }).value;
    assert.ok(moved.includes("moved 3 lines up"), moved);
  });

  it("neutralizes images so descriptions cannot fetch remote content", () => {
    assert.strictEqual(sanitizeDescription("see ![x](https://e.com/p.png)"), "see \\![x](https://e.com/p.png)");
  });
});

describe("validateTour", () => {
  it("accepts the sample tour", () => {
    const result = validateTour(SAMPLE_TOUR, SAMPLE_ID);
    assert.ok(result.ok, JSON.stringify(result));
  });

  it("rejects traversal paths", () => {
    const result = validateTour(readFixtureTour("invalid-traversal"), "invalid-traversal");
    assert.ok(!result.ok && result.errors.some((e) => e.startsWith("/steps/0/file")), JSON.stringify(result));
  });

  it("reports every schema error at once", () => {
    const result = validateTour(readFixtureTour("invalid-schema"), "invalid-schema");
    assert.ok(!result.ok);
    const text = result.errors.join("\n");
    assert.match(text, /unknown property "extra"/);
    assert.match(text, /\/steps\/0\/kind must be one of change, context, risk, decision/);
  });

  it("rejects reversed ranges", () => {
    const tour = structuredClone(SAMPLE_TOUR);
    tour.steps[0].range = { start: 10, end: 9 };
    const result = validateTour(tour);
    assert.ok(!result.ok && result.errors[0].includes("before start"), JSON.stringify(result));
  });

  it("rejects an id that does not match the file name", () => {
    const result = validateTour(readFixtureTour("invalid-id-mismatch"), "invalid-id-mismatch");
    assert.ok(!result.ok && result.errors[0].includes("must match the file name"), JSON.stringify(result));
  });

  for (const bad of ["/abs.ts", "C:/x.ts", "a/../../x.ts", "..\\x.ts"]) {
    it(`schema pattern rejects file ${JSON.stringify(bad)}`, () => {
      const tour = structuredClone(SAMPLE_TOUR);
      tour.steps[0].file = bad;
      assert.ok(!validateTour(tour).ok);
    });
  }
});
