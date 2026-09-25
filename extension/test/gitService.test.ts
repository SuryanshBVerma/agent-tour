import * as assert from "assert";
import * as vscode from "vscode";
import { baseFileForChange, isValidBaseRef, repositoryRelativePath } from "../src/gitService";

describe("isValidBaseRef", () => {
  it("accepts the refs the skill writes and ordinary branch names", () => {
    for (const ref of ["HEAD", "a1b2c3d", "main", "origin/main", "release/1.2", "v1.0.0", "refs/heads/main"]) {
      assert.strictEqual(isValidBaseRef(ref), true, ref);
    }
  });

  it("rejects empty, over-long, option-like and whitespace refs", () => {
    for (const ref of ["", "-x", "--upload-pack=evil", "a".repeat(201), "main branch", "a\tb", "a\u0000b"]) {
      assert.strictEqual(isValidBaseRef(ref), false, JSON.stringify(ref));
    }
  });
});

describe("repositoryRelativePath", () => {
  it("returns a repo-relative posix path for a file inside the repository", () => {
    assert.strictEqual(repositoryRelativePath("/repo", "/repo/src/a.ts"), "src/a.ts");
  });

  it("rejects a file outside the repository or the repository root itself", () => {
    assert.strictEqual(repositoryRelativePath("/repo", "/other/a.ts"), undefined);
    assert.strictEqual(repositoryRelativePath("/repo", "/repo"), undefined);
  });
});

describe("baseFileForChange", () => {
  const working = vscode.Uri.file("/repo/src/new.ts");
  const original = vscode.Uri.file("/repo/src/old.ts");

  it("uses the working file for a modified file, not originalUri", () => {
    // Regression: originalUri is the working path for a modify, so passing it to vscode.diff
    // made both columns show the same content.
    assert.strictEqual(baseFileForChange(5, working, working), working);
  });

  it("uses the pre-rename path for a rename", () => {
    assert.strictEqual(baseFileForChange(3, working, original), original);
  });

  it("returns undefined for an added file", () => {
    assert.strictEqual(baseFileForChange(1, working, working), undefined);
  });
});
