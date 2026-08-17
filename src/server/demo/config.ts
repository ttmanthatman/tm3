import path from "node:path";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function demoModeAvailable(value = process.env.DEMO_MODE) {
  return ENABLED_VALUES.has(String(value || "").trim().toLowerCase());
}

export function githubDemoManifestUrl(repoUrl: string) {
  const trimmed = repoUrl.trim().replace(/\.git$/, "");
  const match = trimmed.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error("演示模式需要 GitHub 仓库地址，或显式设置 DEMO_MANIFEST_URL");
  return `https://github.com/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/releases/download/demo-data/demo-manifest.json`;
}

export function demoManifestUrl(repoUrl: string, override = process.env.DEMO_MANIFEST_URL) {
  return String(override || "").trim() || githubDemoManifestUrl(repoUrl);
}

export function demoStatePath(storageRoot: string) {
  return path.join(storageRoot, "demo-mode-state.json");
}

export function demoCacheDir(storageRoot: string) {
  return path.join(storageRoot, "demo-cache");
}
