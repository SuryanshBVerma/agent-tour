import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  // Pinned to the minimum version in package.json `engines` (see docs/decisions.md).
  version: "1.138.0",
  workspaceFolder: "./test/fixtures/spike-workspace",
  launchArgs: ["--disable-extensions"],
  mocha: {
    ui: "bdd",
    timeout: 20000,
  },
});
