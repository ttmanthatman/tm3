import { execFileSync, spawn } from "node:child_process";
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
  "src/shared/release.ts"
]);

const FULL_CONFIGURATION_PATTERNS = [
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
      fullReason: `${normalized} affects dependencies, TypeScript, or the build`,
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
  } else if (normalized === "src/shared/release.ts") {
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
      return ["npm run check:client", "npm run test:client"];
    case "server":
      return ["npm run check:server", "npm run test:server"];
    case "shared":
      return [
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

function gitOutput(args: string[]) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
  } catch (error) {
    if (error && typeof error === "object") {
      const output = error as { stdout?: string | Buffer; stderr?: string | Buffer };
      if (output.stdout) process.stdout.write(output.stdout);
      if (output.stderr) process.stderr.write(output.stderr);
    }
    throw error;
  }
}

export function detectChangedFiles(base = "HEAD") {
  const diff = gitOutput(["diff", "--name-only", "-z", "--relative", "--no-ext-diff", base, "--"]);
  const untracked = gitOutput(["ls-files", "--others", "--exclude-standard", "-z"]);
  return [...new Set(`${diff}${untracked}`.split("\0").filter(Boolean))].sort();
}

function printPlan(plan: VerificationPlan, base: string) {
  console.log(`Changed files (${plan.files.length}, base ${base}):`);
  for (const file of plan.files) console.log(`  - ${file}`);
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
  return new Promise<number>((resolve, reject) => {
    const child = spawn(npmExecutable(), ["run", script], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        for (const chunk of stdout) process.stdout.write(chunk);
        for (const chunk of stderr) process.stderr.write(chunk);
        if (signal) console.error(`${command} terminated by ${signal}.`);
      }
      resolve(code ?? 1);
    });
  });
}

function parseBase(args: string[]) {
  let base = "HEAD";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--base" || !args[index + 1]) {
      throw new Error(`Unknown or incomplete argument "${args[index]}". Usage: verify:changed -- [--base <ref>]`);
    }
    base = args[index + 1];
    index += 1;
  }
  return base;
}

async function main() {
  const base = parseBase(process.argv.slice(2));
  const plan = createVerificationPlan(detectChangedFiles(base));
  printPlan(plan, base);

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
