import assert from "node:assert/strict";
import test from "node:test";
import {
  additionalContentRules,
  contentViolations,
  formatViolation,
  textFromBuffer,
  trackedPathViolation
} from "./check-public-tree.js";

function posixPath(...segments: string[]) {
  return `/${segments.join("/")}`;
}

function windowsPath(drive: string, ...segments: string[]) {
  return `${drive}:\\${segments.join("\\")}`;
}

test("ordinary public text passes", () => {
  assert.deepEqual(contentViolations("README.md", "Public setup instructions and project overview."), []);
});

test("macOS user directory paths are blocked", () => {
  const text = `Screenshot: ${posixPath("Users", "alice", "workspace", "qa.png")}`;
  assert.equal(contentViolations("notes.md", text)[0]?.category, "macOS user directory path");
});

test("Linux user directory paths are blocked", () => {
  const text = `Report: ${posixPath("home", "alice", "project", "report.html")}`;
  assert.equal(contentViolations("notes.md", text)[0]?.category, "Linux user directory path");
});

test("Windows absolute paths are blocked", () => {
  const text = `Trace: ${windowsPath("C", "Users", "alice", "project", "trace.zip")}`;
  assert.equal(contentViolations("notes.md", text)[0]?.category, "Windows absolute path");
});

test("Codex visualization paths are blocked", () => {
  const text = ["Screenshot:", posixPath("workspace", ".codex", "visualizations", "qa.png")].join(" ");
  assert.equal(contentViolations("notes.md", text)[0]?.category, "Codex visualization path");
});

test("temporary report and local file paths are blocked", () => {
  const report = ["Result:", ["test-results", "run.json"].join("/")].join(" ");
  const temporaryFile = `Trace: ${posixPath("tmp", "tm3", "trace.zip")}`;
  assert.equal(contentViolations("notes.md", report)[0]?.category, "temporary QA report path");
  assert.equal(contentViolations("notes.md", temporaryFile)[0]?.category, "local temporary file path");
});

test("legitimate relative paths and placeholder examples pass", () => {
  const text = [
    "Use docs/images/screenshots/annotated/mobile-overview.png.",
    "Example install path: /home/<name>/project.",
    `Example Windows path: ${windowsPath("C", "<workspace>", "project")}.`,
    "A public URL such as https://example.com/home/alice/project is allowed."
  ].join("\n");
  assert.deepEqual(contentViolations("docs/setup.md", text), []);
});

test("tracked local environment, runtime, agent, and QA paths are blocked", () => {
  assert.equal(trackedPathViolation(".env.local")?.category, "tracked environment file");
  assert.equal(trackedPathViolation("storage/database.sqlite")?.category, "runtime data directory");
  assert.equal(trackedPathViolation("docs/AGENTS.local.md")?.category, "local agent guidance");
  const reportPath = ["playwright-report", "index.html"].join("/");
  assert.equal(trackedPathViolation(reportPath)?.category, "Playwright report directory");
});

test("public environment examples and screenshot assets remain allowed", () => {
  assert.equal(trackedPathViolation(".env.example"), null);
  assert.equal(trackedPathViolation("docs/images/screenshots/annotated/mobile-overview.png"), null);
  assert.equal(trackedPathViolation("public/images/icon-192.png"), null);
});

test("gitignore may list local artifact directories without hiding absolute paths", () => {
  const ignoredPaths = [".codex", "visualizations", ""].join("/");
  assert.deepEqual(contentViolations(".gitignore", ignoredPaths), []);

  const localPath = posixPath("Users", "alice", "workspace", ".gitignore");
  assert.equal(contentViolations(".gitignore", localPath)[0]?.category, "macOS user directory path");
});

test("environment variable patterns remain additive", () => {
  const rules = additionalContentRules("private[.]example");
  const violations = contentViolations("README.md", "Contact private.example for access.", rules);
  assert.equal(violations[0]?.category, "additional forbidden pattern");
});

test("binary buffers are skipped safely", () => {
  assert.equal(textFromBuffer(Buffer.from([0x89, 0x50, 0x00, 0x47])), null);
});

test("formatted failures include the file and rule category", () => {
  assert.equal(
    formatViolation({ file: "notes.md", line: 4, category: "macOS user directory path" }),
    "notes.md:4 [macOS user directory path]"
  );
});
