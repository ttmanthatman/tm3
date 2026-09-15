import assert from "node:assert/strict";
import test from "node:test";
import { githubCommitsUrl, isSafeUpdateCommit, normalizeGitHubCommits, resolveUpdateCommit } from "./updateCommits.js";

const payload = [
  {
    sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    commit: { committer: { date: "2026-09-15T03:00:00Z" }, message: "Fix layout\n\ndetails" }
  },
  {
    sha: "ffffffffffffffffffffffffffffffffffffffff",
    commit: { committer: { date: "2026-09-14T10:00:00Z" }, message: "Initial" }
  }
];

test("commit validation accepts hex shas and rejects anything else", () => {
  assert.ok(isSafeUpdateCommit("a1b2c3d"));
  assert.ok(isSafeUpdateCommit("A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"));
  assert.ok(!isSafeUpdateCommit(""));
  assert.ok(!isSafeUpdateCommit("main"));
  assert.ok(!isSafeUpdateCommit("xyz1234"));
  assert.ok(!isSafeUpdateCommit("a1b2c3d; rm -rf /"));
  assert.ok(!isSafeUpdateCommit("a".repeat(41)));
});

test("GitHub commit payloads normalize to short sha, date, and first message line", () => {
  const commits = normalizeGitHubCommits(payload);
  assert.deepEqual(commits, [
    {
      sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      short: "a1b2c3d",
      committedAt: "2026-09-15T03:00:00Z",
      message: "Fix layout"
    },
    {
      sha: "ffffffffffffffffffffffffffffffffffffffff",
      short: "fffffff",
      committedAt: "2026-09-14T10:00:00Z",
      message: "Initial"
    }
  ]);
  assert.deepEqual(normalizeGitHubCommits("nope"), []);
  assert.deepEqual(normalizeGitHubCommits([{ sha: "not-a-sha" }, null]), []);
});

test("normalization caps the list at the requested limit", () => {
  const many = Array.from({ length: 5 }, (_, index) => ({
    sha: String(index).padStart(40, "0"),
    commit: { committer: { date: "2026-09-15T03:00:00Z" }, message: `c${index}` }
  }));
  assert.equal(normalizeGitHubCommits(many, 3).length, 3);
});

test("requested commit resolves by unique prefix within the branch history", () => {
  const commits = normalizeGitHubCommits(payload);
  assert.equal(resolveUpdateCommit("a1b2c3d", commits)?.sha, payload[0].sha);
  assert.equal(resolveUpdateCommit("f", commits)?.sha, payload[1].sha);
  assert.equal(resolveUpdateCommit(payload[1].sha.toUpperCase(), commits)?.sha, payload[1].sha);
  assert.equal(resolveUpdateCommit("deadbeef", commits), null);
  const ambiguous = normalizeGitHubCommits([
    { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", commit: { committer: { date: "" }, message: "one" } },
    { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2", commit: { committer: { date: "" }, message: "two" } }
  ]);
  assert.equal(resolveUpdateCommit("aaaaaaa", ambiguous), null, "ambiguous prefixes must not resolve");
});

test("commits API url encodes owner, repo, and branch", () => {
  assert.equal(
    githubCommitsUrl("ow ner", "repo", "feature/x", 50),
    "https://api.github.com/repos/ow%20ner/repo/commits?sha=feature%2Fx&per_page=50"
  );
});
