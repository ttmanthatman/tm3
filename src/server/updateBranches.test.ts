import assert from "node:assert/strict";
import test from "node:test";
import { availableDefaultUpdateBranch, normalizeUpdateBranches, selectUpdateBranch } from "./updateBranches.js";

test("update branch list keeps valid unique names including slash refs", () => {
  assert.deepEqual(
    normalizeUpdateBranches(["main", "codex/oops", "main", "bad branch", "topic..broken", 1]),
    ["codex/oops", "main"]
  );
});

test("selected update branch must be present in GitHub branch list", () => {
  const branches = ["codex/oops", "main"];
  assert.equal(selectUpdateBranch("codex/oops", branches, "main"), "codex/oops");
  assert.equal(selectUpdateBranch(undefined, branches, "main"), "main");
  assert.throws(() => selectUpdateBranch("missing", branches, "main"), /所选分支不可用/);
});

test("a removed saved branch falls back to the environment default", () => {
  assert.equal(availableDefaultUpdateBranch(["main", "preview"], "removed", "main"), "main");
});
