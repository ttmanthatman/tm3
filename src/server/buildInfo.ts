import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./storageDirs.js";

export interface ServerBuildInfo {
  commit: string | null;
  committedAt: string | null;
  dirty: boolean;
}

let cached: ServerBuildInfo | null | undefined;

export function currentBuildInfo(): ServerBuildInfo | null {
  if (cached !== undefined) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "build-info.json"), "utf8")) as {
      commit?: unknown;
      committedAt?: unknown;
      dirty?: unknown;
    };
    cached = {
      commit: typeof raw.commit === "string" && /^[0-9a-f]{40}$/i.test(raw.commit) ? raw.commit : null,
      committedAt: typeof raw.committedAt === "string" ? raw.committedAt : null,
      dirty: raw.dirty === true
    };
  } catch {
    cached = null;
  }
  return cached;
}
