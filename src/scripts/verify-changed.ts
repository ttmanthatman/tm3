import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const VERIFY_DOMAINS = [
  "client",
  "server",
  "shared",
  "prisma",
  "service-worker",
  "scripts",
  "documentation/release",
  "GitHub workflow",
  "configuration",
  "unknown critical"
] as const;

export type VerifyDomain = (typeof VERIFY_DOMAINS)[number];

interface FileClassification {
  domains: VerifyDomain[];
  requiresFull: boolean;
  fullReason?: string;
  requiresReleaseCheck: boolean;
}

export interface VerificationPlan {
  files: string[];
  domains: VerifyDomain[];
  commands: string[];
  fallbackReasons: string[];
}

const COMMAND_ORDER = [
  "npm run prisma:generate",
  "npm run check:public-tree",
  "npm run check:release",
  "npm run lint",
  "npm run check:client",
  "npm run check:server",
  "npm run test:client",
  "npm run test:server",
  "npm run test:shared",
  "npm run test:scripts",
  "npm run test:service-worker",
  "npm run build:server"
] as const;

const RELEASE_FILES = new Set([
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "public/sw.js",
  "src/client/main.ts",
  "src/shared/release.ts",
  "src/shared/releaseHistory.ts"
]);

const FULL_CONFIGURATION_PATTERNS = [
  /^src\/scripts\/(?:verify-changed|run-tests|test-file-groups)\.ts$/,
  /^(?:package|npm-shrinkwrap)(?:-lock)?\.json$/,
  /^tsconfig(?:\.[^/]+)?\.json$/,
  /^vite\.config\.[^/]+$/,
  /^index\.html$/
];

function normalizeFile(file: string) {
  return file.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function classifyChangedFile(file: string): FileClassification {
  const normalized = normalizeFile(file);
  const domains: VerifyDomain[] = [];
  const add = (domain: VerifyDomain) => {
    if (!domains.includes(domain)) domains.push(domain);
  };

  if (normalized.startsWith(".github/workflows/")) {
    add("GitHub workflow");
    return {
      domains,
      requiresFull: true,
      fullReason: `${normalized} changes CI verification`,
      requiresReleaseCheck: false
    };
  }

  if (FULL_CONFIGURATION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    add("configuration");
    return {
      domains,
      requiresFull: true,
      fullReason: `${normalized} affects verification, dependencies, TypeScript, or the build`,
      requiresReleaseCheck: RELEASE_FILES.has(normalized)
    };
  }

  if (normalized === "prisma/schema.prisma" || normalized.startsWith("prisma/")) {
    add("prisma");
  } else if (
    normalized === "public/sw.js"
    || normalized === "src/scripts/service-worker.test.ts"
  ) {
    add("service-worker");
  } else if (normalized === "src/shared/release.ts" || normalized === "src/shared/releaseHistory.ts") {
    add("shared");
    add("documentation/release");
  } else if (normalized === "src/client/main.ts") {
    add("client");
    add("documentation/release");
  } else if (normalized.startsWith("src/client/")) {
    add(path.posix.basename(normalized) === "AGENTS.md" ? "documentation/release" : "client");
  } else if (normalized.startsWith("src/server/")) {
    add(path.posix.basename(normalized) === "AGENTS.md" ? "documentation/release" : "server");
  } else if (normalized.startsWith("src/shared/")) {
    add("shared");
  } else if (normalized.startsWith("src/scripts/") || normalized.startsWith("scripts/")) {
    add("scripts");
  } else if (
    normalized.startsWith("docs/")
    || normalized === "AGENTS.md"
    || normalized === "README.md"
    || normalized === "CHANGELOG.md"
    || normalized === "LICENSE"
    || normalized === ".github/pull_request_template.md"
  ) {
    add("documentation/release");
  } else if (normalized.startsWith("public/")) {
    add("client");
  } else {
    add("unknown critical");
    return {
      domains,
      requiresFull: true,
      fullReason: `${normalized || "(empty path)"} has no safe focused mapping`,
      requiresReleaseCheck: false
    };
  }

  return {
    domains,
    requiresFull: false,
    requiresReleaseCheck: RELEASE_FILES.has(normalized)
  };
}

function commandsForDomain(domain: VerifyDomain) {
  switch (domain) {
    case "client":
      return ["npm run lint", "npm run check:client", "npm run test:client"];
    case "server":
      return ["npm run lint", "npm run check:server", "npm run test:server"];
    case "shared":
      return [
        "npm run lint",
        "npm run check:client",
        "npm run check:server",
        "npm run test:client",
        "npm run test:server",
        "npm run test:shared"
      ];
    case "prisma":
      return [
        "npm run prisma:generate",
        "npm run check:server",
        "npm run test:server",
        "npm run build:server"
      ];
    case "service-worker":
      return ["npm run test:service-worker", "npm run check:release"];
    case "scripts":
      return ["npm run check:server", "npm run test:scripts"];
    case "documentation/release":
      return ["npm run check:public-tree"];
    case "GitHub workflow":
    case "configuration":
    case "unknown critical":
      return [];
  }
}

export function createVerificationPlan(inputFiles: readonly string[]): VerificationPlan {
  const files = [...new Set(inputFiles.map(normalizeFile).filter(Boolean))].sort();
  const classifications = files.map(classifyChangedFile);
  const domains = VERIFY_DOMAINS.filter((domain) =>
    classifications.some((classification) => classification.domains.includes(domain))
  );
  const fallbackReasons = classifications.flatMap((classification) =>
    classification.requiresFull && classification.fullReason ? [classification.fullReason] : []
  );

  if (fallbackReasons.length) {
    return { files, domains, commands: ["npm run verify:full"], fallbackReasons };
  }

  const requestedCommands = new Set(domains.flatMap(commandsForDomain));
  if (classifications.some((classification) => classification.requiresReleaseCheck)) {
    requestedCommands.add("npm run check:release");
  }
  const commands = COMMAND_ORDER.filter((command) => requestedCommands.has(command));
  return { files, domains, commands, fallbackReasons };
}

function gitOutput(args: string[], root = ROOT) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" });
  } catch (error) {
    if (error && typeof error === "object") {
      const output = error as { stdout?: string | Buffer; stderr?: string | Buffer };
      if (output.stdout) process.stdout.write(output.stdout);
      if (output.stderr) process.stderr.write(output.stderr);
    }
    throw error;
  }
}

export function detectChangedFiles(base = "HEAD", options: { staged?: boolean; root?: string } = {}) {
  const root = options.root ?? ROOT;
  if (options.staged) {
    // Checks execute in the working tree, so tracked content must match the index.
    const unstaged = gitOutput(["diff", "--name-only", "-z", "--no-ext-diff", "--"], root);
    if (unstaged) {
      throw new Error("--staged requires tracked files to match the index. Finish staging task-owned changes, or use an isolated worktree; do not stage unrelated work.");
    }
    return gitOutput(["diff", "--cached", "--name-only", "-z", "--relative", "--no-ext-diff", "--no-renames", base, "--"], root)
      .split("\0").filter(Boolean).sort();
  }
  const diff = gitOutput(["diff", "--name-only", "-z", "--relative", "--no-ext-diff", "--no-renames", base, "--"], root);
  const untracked = gitOutput(["ls-files", "--others", "--exclude-standard", "-z"], root);
  return [...new Set(`${diff}${untracked}`.split("\0").filter(Boolean))].sort();
}

function printPlan(plan: VerificationPlan, base: string, quiet: boolean) {
  console.log(`Changed files (${plan.files.length}, ${base}):`);
  if (!quiet) for (const file of plan.files) console.log(`  - ${file}`);
  if (!plan.files.length) console.log("  (none)");
  console.log(`Domains: ${plan.domains.length ? plan.domains.join(", ") : "none"}`);
  if (plan.fallbackReasons.length) {
    console.log("Focused scope is unsafe; using full verification:");
    for (const reason of plan.fallbackReasons) console.log(`  - ${reason}`);
  }
  console.log("Commands:");
  for (const command of plan.commands) console.log(`  - ${command}`);
  if (!plan.commands.length) console.log("  (none)");
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function runNpmCommand(command: string) {
  const script = command.replace(/^npm run /, "");
  const logFile = path.join(mkdtempSync(path.join(tmpdir(), "teamchat-verify-")), "output.log");
  const logFd = openSync(logFile, "w", 0o600);
  console.log(`Running: ${command} (log: ${logFile})`);
  try {
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(npmExecutable(), ["run", script], {
        cwd: ROOT,
        env: process.env,
        stdio: ["ignore", logFd, logFd]
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (code !== 0) {
          const output = readFileSync(logFile, "utf8");
          console.error(output.slice(-6000));
          console.error(`Full failure log: ${logFile}`);
          if (signal) console.error(`${command} terminated by ${signal}.`);
        }
        resolve(code ?? 1);
      });
    });
  } finally {
    closeSync(logFd);
  }
}

export function parseOptions(args: string[]) {
  let base = "HEAD";
  let explicitBase = false;
  let staged = false;
  let dryRun = false;
  let quiet = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--staged") staged = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--base" && args[index + 1] && !args[index + 1].startsWith("-")) {
      base = args[++index];
      explicitBase = true;
    } else {
      throw new Error(`Unknown or incomplete argument "${arg}". Usage: verify:changed -- [--base <ref> | --staged] [--dry-run] [--quiet]`);
    }
  }
  if (staged && explicitBase) throw new Error("--staged and --base cannot be combined.");
  return { base, staged, dryRun, quiet };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const plan = createVerificationPlan(detectChangedFiles(options.base, options));
  printPlan(plan, options.staged ? "staged against HEAD; untracked files excluded" : `base ${options.base}`, options.quiet);
  if (options.dryRun) {
    console.log("Dry run: no checks executed.");
    return 0;
  }
  if (!plan.commands.length) {
    console.error("No checks selected; this is not a verification pass. Use --base <task-baseline> for committed changes.");
    return 1;
  }

  for (const command of plan.commands) {
    const status = await runNpmCommand(command);
    if (status !== 0) {
      console.error(`Failed: ${command}`);
      return status;
    }
    console.log(`Passed: ${command}`);
  }
  return 0;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main()
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
