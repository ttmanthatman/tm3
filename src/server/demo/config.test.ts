import assert from "node:assert/strict";
import test from "node:test";
import { demoManifestUrl, demoModeAvailable, githubDemoManifestUrl } from "./config.js";

test("demo mode is disabled unless explicitly enabled", () => {
  assert.equal(demoModeAvailable(undefined), false);
  assert.equal(demoModeAvailable("0"), false);
  assert.equal(demoModeAvailable("true"), true);
  assert.equal(demoModeAvailable("1"), true);
});

test("derives the on-demand demo manifest from the configured GitHub repository", () => {
  assert.equal(
    githubDemoManifestUrl("https://github.com/example/team-chat.git"),
    "https://github.com/example/team-chat/releases/download/demo-data/demo-manifest.json"
  );
  assert.equal(demoManifestUrl("https://github.com/example/team-chat.git", "https://raw.githubusercontent.com/example/demo/main/manifest.json"), "https://raw.githubusercontent.com/example/demo/main/manifest.json");
});
