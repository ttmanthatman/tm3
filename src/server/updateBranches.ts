const UNSAFE_REF_CHARACTERS = /[\u0000-\u0020~^:?*\\[\\]/;

export function isSafeUpdateBranch(value: string): boolean {
  return value.length > 0
    && value.length <= 255
    && !value.startsWith("-")
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.endsWith(".")
    && !value.includes("..")
    && !value.includes("//")
    && !value.includes("@{")
    && !UNSAFE_REF_CHARACTERS.test(value);
}

export function normalizeUpdateBranches(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && isSafeUpdateBranch(value)))].sort((a, b) => a.localeCompare(b));
}

export function selectUpdateBranch(requested: unknown, branches: readonly string[], fallback: string): string {
  const branch = typeof requested === "string" && requested.trim() ? requested.trim() : fallback;
  if (!isSafeUpdateBranch(branch) || !branches.includes(branch)) throw new Error("所选分支不可用");
  return branch;
}

export function availableDefaultUpdateBranch(branches: readonly string[], configured: string, environmentDefault: string): string {
  if (branches.includes(configured)) return configured;
  if (branches.includes(environmentDefault)) return environmentDefault;
  if (branches[0]) return branches[0];
  throw new Error("GitHub 没有可用更新分支");
}
