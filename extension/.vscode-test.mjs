import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  // Defaults to the minimum version in package.json `engines`; CI also runs "stable".
  version: process.env.VSCODE_TEST_VERSION || "1.90.0",
  workspaceFolder: "./test/fixtures/sample-workspace",
  launchArgs: ["--disable-extensions"],
  mocha: {
    ui: "bdd",
    timeout: 20000,
  },
});
