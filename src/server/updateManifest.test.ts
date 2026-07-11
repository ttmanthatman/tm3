import assert from "node:assert/strict";
import test from "node:test";
import { githubPackageManifestUrl } from "./updateManifest.js";

test("GitHub manifest URL preserves a slash in the branch ref", () => {
  assert.equal(
    githubPackageManifestUrl("ttmanthatman", "tm3", "codex/parallax-background-test"),
    "https://api.github.com/repos/ttmanthatman/tm3/contents/package.json?ref=codex%2Fparallax-background-test"
  );
});
