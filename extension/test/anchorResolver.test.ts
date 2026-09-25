import * as assert from "assert";
import * as vscode from "vscode";
import { formatDelta, resolveStep } from "../src/anchorResolver";
import type { TourStep } from "../src/types";

async function doc(lines: string[]): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument({ content: lines.join("\n"), language: "plaintext" });
}

function step(start: number, end: number, anchor: string): TourStep {
  return { file: "x.ts", range: { start, end }, anchor, kind: "change", title: "t", description: "" };
}

/** Lines "line 1".."line n" with `inserts` spliced in at 0-based positions. */
function lines(n: number, inserts: Record<number, string> = {}): string[] {
  const out = Array.from({ length: n }, (_, i) => `line ${i + 1}`);
  for (const [at, text] of Object.entries(inserts).sort(([a], [b]) => Number(b) - Number(a))) {
    out.splice(Number(at), 0, text);
  }
  return out;
}

describe("resolveStep", () => {
  it("is exact when the anchor is on the declared line", async () => {
    const d = await doc(lines(20, { 9: "function target() {" }));
    const r = resolveStep(d, step(10, 12, "function target("));
    assert.strictEqual(r.status, "exact");
    assert.deepStrictEqual([r.range.start.line, r.range.end.line], [9, 11]);
  });

  it("relocates when lines were inserted above, keeping the range length", async () => {
    const d = await doc(lines(20, { 12: "function target() {" }));
    const r = resolveStep(d, step(10, 12, "function target("));
    assert.strictEqual(r.status, "relocated");
    assert.strictEqual(r.status === "relocated" && r.delta, 3);
    assert.deepStrictEqual([r.range.start.line, r.range.end.line], [12, 14]);
  });

  it("treats a re-indented anchor on the declared line as exact", async () => {
    const d = await doc(lines(20, { 9: "\t\tfunction   target() {" }));
    assert.strictEqual(resolveStep(d, step(10, 10, "function target(")).status, "exact");
  });

  it("prefers a reformatted match nearby over an identical match far away", async () => {
    const d = await doc(lines(200, { 11: "function  target() {", 150: "function target() {" }));
    const r = resolveStep(d, step(10, 10, "function target("));
    assert.strictEqual(r.range.start.line, 11);
  });

  it("finds the anchor anywhere in the file when it moved far", async () => {
    const d = await doc(lines(300, { 250: "function target() {" }));
    const r = resolveStep(d, step(10, 12, "function target("));
    assert.strictEqual(r.status, "relocated");
    assert.strictEqual(r.range.start.line, 250);
  });

  it("breaks ties toward the line above", async () => {
    const d = await doc(lines(20, { 7: "dup()", 12: "dup()" }));
    // After both inserts, "dup()" sits on 0-based lines 7 and 13; declared 0-based line 10.
    const r = resolveStep(d, step(11, 11, "dup()"));
    assert.strictEqual(r.range.start.line, 7);
  });

  it("relocates a step whose declared range is past the end of the file", async () => {
    const d = await doc(lines(10, { 4: "function target() {" }));
    const r = resolveStep(d, step(40, 45, "function target("));
    assert.strictEqual(r.status, "relocated");
    assert.deepStrictEqual([r.range.start.line, r.range.end.line], [4, 9]);
  });

  it("is stale with the declared, clamped range when the anchor is gone", async () => {
    const d = await doc(lines(10));
    const r = resolveStep(d, step(8, 14, "function target("));
    assert.strictEqual(r.status, "stale");
    assert.deepStrictEqual([r.range.start.line, r.range.end.line], [7, 9]);
  });
});

describe("formatDelta", () => {
  it("formats direction and plural", () => {
    assert.strictEqual(formatDelta(1), "1 line down");
    assert.strictEqual(formatDelta(-4), "4 lines up");
  });
});
