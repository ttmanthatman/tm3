const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

export interface UpdateCommit {
  sha: string;
  short: string;
  committedAt: string;
  message: string;
}

export function isSafeUpdateCommit(value: string): boolean {
  return COMMIT_SHA.test(value);
}

export function normalizeGitHubCommits(payload: unknown, limit = 30): UpdateCommit[] {
  if (!Array.isArray(payload)) return [];
  const commits: UpdateCommit[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const entry = item as {
      sha?: unknown;
      commit?: { committer?: { date?: unknown }; message?: unknown };
    };
    if (typeof entry.sha !== "string" || !/^[0-9a-f]{40}$/i.test(entry.sha)) continue;
    const committedAt = typeof entry.commit?.committer?.date === "string" ? entry.commit.committer.date : "";
    const firstLine = typeof entry.commit?.message === "string" ? entry.commit.message.split("\n", 1)[0].trim() : "";
    commits.push({
      sha: entry.sha,
      short: entry.sha.slice(0, 7),
      committedAt,
      message: firstLine.slice(0, 80)
    });
    if (commits.length >= limit) break;
  }
  return commits;
}

export function resolveUpdateCommit(requested: string, commits: readonly UpdateCommit[]): UpdateCommit | null {
  const needle = requested.toLowerCase();
  const matches = commits.filter((commit) => commit.sha.toLowerCase().startsWith(needle));
  return matches.length === 1 ? matches[0] : null;
}

export function githubCommitsUrl(owner: string, repo: string, branch: string, perPage: number) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`;
}
