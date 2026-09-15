import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD_INFO_PATH = path.join(ROOT, "build-info.json");

interface BuildInfo {
  commit: string | null;
  committedAt: string | null;
  dirty: boolean;
}

function gitInfo(): BuildInfo | null {
  try {
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const commit = run(["log", "-1", "--format=%H"]);
    const committedAt = run(["log", "-1", "--format=%cI"]);
    const dirty = run(["status", "--porcelain", "-uno"]).length > 0;
    if (!/^[0-9a-f]{40}$/i.test(commit)) return null;
    return { commit, committedAt: committedAt || null, dirty };
  } catch {
    return null;
  }
}

function main() {
  const info = gitInfo();
  if (!info && fs.existsSync(BUILD_INFO_PATH)) {
    // No .git here (rsync-deployed tree): keep the build info that was uploaded with the source.
    console.log("build-info: no git metadata, keeping existing build-info.json");
    return;
  }
  const payload: BuildInfo = info ?? { commit: null, committedAt: null, dirty: false };
  fs.writeFileSync(BUILD_INFO_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`build-info: ${payload.commit ? payload.commit.slice(0, 7) : "unknown"}${payload.dirty ? " (dirty)" : ""}`);
}

main();
