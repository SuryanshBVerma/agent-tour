import * as assert from "assert";
import * as vscode from "vscode";
import { relativeLeavesRoot } from "../src/pathRules";
import { resolveWorkspaceFile } from "../src/paths";
import { clampOpacity } from "../src/spotlightRenderer";
import { CARD_COMMANDS, renderCard, sanitizeDescription } from "../src/stepCard";
import { parseStartUri } from "../src/triggerHandler";
import { validateTour } from "../src/tourValidation";
import { SAMPLE_TOUR, readFixtureTour } from "./helpers";

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
  it("keeps agent text out of every part that allows HTML or commands", () => {
    const tour = structuredClone(SAMPLE_TOUR);
    tour.steps[0].title = "TITLE-MARKER <b>x</b>";
    tour.steps[0].description = "DESC-MARKER [x](command:workbench.action.quit) <img src=x>";
    const { header, body, footer } = renderCard(tour, 0, EXACT);

    // Header may use HTML (for the badge) but is never trusted and holds no agent text.
    assert.strictEqual(header.supportHtml, true);
    assert.ok(!header.isTrusted);
    assert.ok(!/MARKER/.test(header.value), header.value);

    // Body holds the agent text: no HTML, no commands at all.
    assert.strictEqual(body.supportHtml, false);
    assert.ok(!body.isTrusted);
    assert.ok(body.value.includes("TITLE-MARKER") && body.value.includes("DESC-MARKER"));

    // Footer runs only this extension's navigation commands, and holds no agent text.
    assert.deepStrictEqual(footer.isTrusted, { enabledCommands: [...CARD_COMMANDS] });
    assert.strictEqual(footer.supportHtml, false);
    assert.ok(!/MARKER/.test(footer.value));
  });

  it("colors the kind badge with the kind's theme color", () => {
    for (const [i, kind] of [[0, "change"], [1, "context"], [2, "risk"], [3, "decision"]] as const) {
      const { header } = renderCard(SAMPLE_TOUR, i, EXACT);
      assert.strictEqual(SAMPLE_TOUR.steps[i].kind, kind);
      // Exactly the style shape VS Code's hover sanitizer keeps.
      assert.ok(
        header.value.includes(`<span style="color:var(--vscode-editor-background);background-color:var(--vscode-agentTour-${kind}Border);">`),
        header.value,
      );
    }
  });

  it("shows no Previous on the first step and Finish on the last", () => {
    const first = renderCard(SAMPLE_TOUR, 0, EXACT);
    const last = renderCard(SAMPLE_TOUR, SAMPLE_TOUR.steps.length - 1, EXACT);
    assert.ok(!first.footer.value.includes("command:agentTour.previous"));
    assert.ok(first.header.value.includes(`Step 1 of ${SAMPLE_TOUR.steps.length}`));
    assert.strictEqual(first.label, `Step 1 of ${SAMPLE_TOUR.steps.length} · Change`);
    assert.ok(last.footer.value.includes("Finish"));
    assert.ok(last.footer.value.includes("command:agentTour.previous"));
  });

  it("marks stale and relocated steps", () => {
    const stale = renderCard(SAMPLE_TOUR, 0, { status: "stale", range: ZERO });
    assert.ok(stale.header.value.includes("agentTour-staleBorder"), stale.header.value);
    assert.ok(stale.label.endsWith("· Stale"));
    const moved = renderCard(SAMPLE_TOUR, 0, { status: "relocated", range: ZERO, delta: -3 }).header.value;
    assert.ok(moved.includes("moved 3 lines up"), moved);
  });

  it("neutralizes images so descriptions cannot fetch remote content", () => {
    assert.strictEqual(sanitizeDescription("see ![x](https://e.com/p.png)"), "see \\![x](https://e.com/p.png)");
  });
});

describe("validateTour", () => {
  it("accepts the sample tour", () => {
    const result = validateTour(SAMPLE_TOUR);
    assert.ok(result.ok, JSON.stringify(result));
  });

  it("rejects traversal paths", () => {
    const result = validateTour(readFixtureTour("invalid-traversal"));
    assert.ok(!result.ok && result.errors.some((e) => e.startsWith("/steps/0/file")), JSON.stringify(result));
  });

  it("reports every schema error at once", () => {
    const result = validateTour(readFixtureTour("invalid-schema"));
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

  for (const bad of ["/abs.ts", "C:/x.ts", "a/../../x.ts", "..\\x.ts"]) {
    it(`schema pattern rejects file ${JSON.stringify(bad)}`, () => {
      const tour = structuredClone(SAMPLE_TOUR);
      tour.steps[0].file = bad;
      assert.ok(!validateTour(tour).ok);
    });
  }
});
