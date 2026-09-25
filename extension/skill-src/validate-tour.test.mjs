// Tests the bundled validator exactly as agents run it: `node validate-tour.mjs ...`.
// Run with `npm run test:skill` (compiles and builds the bundle first).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const validator = join(here, "..", "..", "skill", "code-tour", "scripts", "validate-tour.mjs");
const fixture = join(here, "..", "test", "fixtures", "sample-workspace");
const sample = JSON.parse(readFileSync(join(here, "..", "test", "fixtures", "tours", "2026-09-25-rate-limiting.json"), "utf8"));
// The tsc output of the same module the bundle contains, to compute expected paths.
const { tourDraftPath, tourSlotPath } = createRequire(import.meta.url)("../out/src/tourLocation.js");

let root;
let drafts;

before(() => {
  root = mkdtempSync(join(tmpdir(), "agent-tour-validator-"));
  for (const file of ["src/middleware/rateLimit.ts", "src/router.ts", "test/rateLimit.test.ts"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), readFileSync(join(fixture, file)));
  }
  drafts = mkdtempSync(join(tmpdir(), "agent-tour-drafts-"));
});

after(() => {
  rmSync(tourSlotPath(root), { force: true });
  rmSync(tourDraftPath(root), { force: true });
  rmSync(root, { recursive: true, force: true });
  rmSync(drafts, { recursive: true, force: true });
});

function run(args) {
  const result = spawnSync(process.execPath, [validator, ...args], { cwd: root, encoding: "utf8" });
  return { code: result.status, out: result.stdout + result.stderr };
}

/** Writes `tour` as a draft outside the workspace and validates it from the workspace root. */
function validate(tour, { raw } = {}) {
  const file = join(drafts, "draft.json");
  writeFileSync(file, raw ?? JSON.stringify(tour, null, 2));
  return run([file]);
}

function variant(edit) {
  const tour = structuredClone(sample);
  tour.id = "variant";
  edit(tour);
  return tour;
}

describe("validate-tour.mjs", () => {
  it("accepts the sample tour", () => {
    const { code, out } = validate(sample);
    assert.equal(code, 0, out);
    assert.match(out, /VALID: 5 steps, 0 warnings/);
  });

  it("explains how to fix an anchor that is on a different line", () => {
    const { code, out } = validate(variant((t) => (t.steps[0].range = { start: 22, end: 38 })));
    assert.equal(code, 1, out);
    assert.match(out, /anchor is not on line 22 .* but on line 25\. If that is the intended code, set range to \{ start: 25, end: 41 \}/);
  });

  it("reports an anchor that is not in the file, quoting the start line", () => {
    const { code, out } = validate(variant((t) => (t.steps[0].anchor = "function nowhere(")));
    assert.equal(code, 1, out);
    assert.match(out, /does not appear in src\/middleware\/rateLimit\.ts\. Copy it exactly from line 25, which is "export function rateLimiter/);
  });

  it("reports missing files and ranges past the end of the file", () => {
    const { code, out } = validate(
      variant((t) => {
        t.steps[1].file = "src/gone.ts";
        t.steps[3].range = { start: 11, end: 200 };
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /step 2 .*file "src\/gone\.ts" does not exist/);
    assert.match(out, /step 4 .*range ends at line 200, but src\/router\.ts has \d+ lines/);
  });

  it("reports overlapping steps in the same file", () => {
    const { code, out } = validate(variant((t) => (t.steps[1].range = { start: 16, end: 26 })));
    assert.equal(code, 1, out);
    assert.match(out, /overlap step/);
  });

  it("reports schema errors, including path traversal", () => {
    const { code, out } = validate(
      variant((t) => {
        t.steps[0].kind = "bug";
        t.steps[1].file = "../outside.ts";
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /ERROR \/steps\/0\/kind must be one of/);
    assert.match(out, /ERROR \/steps\/1\/file/);
  });

  it("--where prints the draft and slot paths, outside the workspace", () => {
    const { code, out } = run(["--where"]);
    assert.equal(code, 0, out);
    assert.ok(out.includes(`draft: ${tourDraftPath(root)}`), out);
    assert.ok(out.includes(`slot:  ${tourSlotPath(root)}`), out);
    assert.ok(!tourSlotPath(root).startsWith(root));
    assert.ok(existsSync(dirname(tourDraftPath(root))), "draft folder not created");
  });

  it("--publish replaces the workspace's tour and removes the draft", () => {
    const draft = tourDraftPath(root);
    writeFileSync(draft, JSON.stringify(sample));
    const first = run([draft, "--publish"]);
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /PUBLISHED: /);
    assert.equal(JSON.parse(readFileSync(tourSlotPath(root), "utf8")).id, sample.id);
    assert.ok(!existsSync(draft), "draft not removed");

    writeFileSync(draft, JSON.stringify({ ...sample, id: "second-tour" }));
    assert.equal(run([draft, "--publish"]).code, 0);
    assert.equal(JSON.parse(readFileSync(tourSlotPath(root), "utf8")).id, "second-tour", "not replaced");
  });

  it("--publish leaves the current tour untouched when the draft is invalid", () => {
    const draft = tourDraftPath(root);
    writeFileSync(draft, JSON.stringify(sample));
    run([draft, "--publish"]);
    const broken = { ...sample, id: "broken", steps: [{ ...sample.steps[0], anchor: "function nowhere(" }] };
    writeFileSync(draft, JSON.stringify(broken));
    const { code, out } = run([draft, "--publish"]);
    assert.equal(code, 1, out);
    assert.doesNotMatch(out, /PUBLISHED/);
    assert.equal(JSON.parse(readFileSync(tourSlotPath(root), "utf8")).id, sample.id);
  });

  it("warns when the draft is inside the workspace", () => {
    const inside = join(root, "draft.json");
    writeFileSync(inside, JSON.stringify(sample));
    const { code, out } = run([inside]);
    rmSync(inside);
    assert.equal(code, 0, out);
    assert.match(out, /WARN .*draft is inside the workspace/);
  });

  it("refuses a tour folder other users can write to (POSIX)", { skip: process.platform === "win32" && "Windows temp folders are per-user" }, () => {
    const { tourRootProblem } = createRequire(import.meta.url)("../out/src/tourLocation.js");
    const shared = mkdtempSync(join(tmpdir(), "agent-tour-shared-"));
    try {
      chmodSync(shared, 0o777);
      assert.match(tourRootProblem(shared), /writable by other users/);
      chmodSync(shared, 0o700);
      assert.equal(tourRootProblem(shared), undefined);
    } finally {
      rmSync(shared, { recursive: true, force: true });
    }
  });

  it("rejects --where combined with a draft", () => {
    assert.equal(run(["--where", "x.json"]).code, 2);
  });

  it("rejects invalid JSON", () => {
    const { code, out } = validate(sample, { raw: "{ not json" });
    assert.equal(code, 1, out);
    assert.match(out, /not valid JSON/);
  });

  it("errors above 20 steps and warns outside 3–12", () => {
    // 21 one-line steps over the 44-line rateLimit.ts, each anchored on its own line.
    const file = "src/middleware/rateLimit.ts";
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    const many = variant((t) => {
      t.steps = Array.from({ length: 21 }, (_, i) => ({
        ...sample.steps[0],
        file,
        range: { start: 1 + i, end: 1 + i },
        anchor: lines[i].trim() || "x",
      }));
    });
    assert.match(validate(many).out, /tour has 21 steps; the maximum is 20/);

    const { code, out } = validate(variant((t) => (t.steps = t.steps.slice(0, 2))));
    assert.equal(code, 0, out);
    assert.match(out, /WARN .*tour has 2 steps; aim for 3–12/);
  });

  it("warns about descriptions missing the What / Why / Watch for pattern", () => {
    const { code, out } = validate(
      variant((t) => {
        t.steps[0].description = "Adds middleware.";
        t.steps[2].description = "Memory could grow.";
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /step 1 .*no "\*\*What:\*\*" section/);
    assert.match(out, /step 3 .*risk step has no "\*\*Watch for:\*\*" section/);
  });

  it("does not follow a symlinked directory out of the workspace", () => {
    const outside = mkdtempSync(join(tmpdir(), "agent-tour-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "export const secretValue = 1;\n");
      // A junction needs no admin rights on Windows; elsewhere it is a normal dir symlink.
      symlinkSync(outside, join(root, "linked"), "junction");
      const { code, out } = validate(
        variant((t) => {
          t.steps[4] = { ...t.steps[4], file: "linked/secret.txt", range: { start: 1, end: 1 }, anchor: "export const secretValue" };
        }),
      );
      assert.equal(code, 1, out);
      assert.match(out, /step 5 .*file "linked\/secret\.txt" does not exist/);
    } finally {
      rmSync(join(root, "linked"), { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("reads files whose name merely starts with two dots", () => {
    mkdirSync(join(root, "..config"), { recursive: true });
    writeFileSync(join(root, "..config", "settings.ts"), "export const dottedSetting = true;\n");
    const { code, out } = validate(
      variant((t) => {
        t.steps[4] = { ...t.steps[4], file: "..config/settings.ts", range: { start: 1, end: 1 }, anchor: "export const dottedSetting" };
      }),
    );
    assert.equal(code, 0, out);
  });

  it("warns about descriptions too long for the card", () => {
    const { code, out } = validate(variant((t) => (t.steps[0].description = `**What:** ${"x".repeat(1100)}`)));
    assert.equal(code, 0, out);
    assert.match(out, /step 1 .*description is \d+ characters; keep it under 1000/);
  });

  it("prints usage and exits 2 without a tour path", () => {
    const result = spawnSync(process.execPath, [validator], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:/);
  });

  it("ships a schema identical to the extension's canonical schema", () => {
    const canonical = readFileSync(join(here, "..", "schema", "tour.schema.json"), "utf8");
    const copy = readFileSync(join(here, "..", "..", "skill", "code-tour", "schema", "tour.schema.json"), "utf8");
    assert.equal(copy, canonical);
  });
});
