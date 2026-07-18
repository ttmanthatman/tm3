import assert from "node:assert/strict";
import test from "node:test";
import { createVerificationPlan } from "./verify-changed.js";

function summary(files: string[]) {
  const plan = createVerificationPlan(files);
  return {
    domains: plan.domains,
    commands: plan.commands,
    fallbackReasons: plan.fallbackReasons
  };
}

test("single client file runs client type checking and tests", () => {
  assert.deepEqual(summary(["src/client/store.ts"]), {
    domains: ["client"],
    commands: ["npm run check:client", "npm run test:client"],
    fallbackReasons: []
  });
});

test("single server file runs server type checking and tests", () => {
  assert.deepEqual(summary(["src/server/linkPreview.ts"]), {
    domains: ["server"],
    commands: ["npm run check:server", "npm run test:server"],
    fallbackReasons: []
  });
});

test("shared types cover both clients plus shared tests", () => {
  assert.deepEqual(summary(["src/shared/types.ts"]), {
    domains: ["shared"],
    commands: [
      "npm run check:client",
      "npm run check:server",
      "npm run test:client",
      "npm run test:server",
      "npm run test:shared"
    ],
    fallbackReasons: []
  });
});

test("Prisma schema generates the client and performs full server verification", () => {
  assert.deepEqual(summary(["prisma/schema.prisma"]), {
    domains: ["prisma"],
    commands: [
      "npm run prisma:generate",
      "npm run check:server",
      "npm run test:server",
      "npm run build:server"
    ],
    fallbackReasons: []
  });
});

test("package metadata falls back to full verification", () => {
  const plan = summary(["package.json"]);
  assert.deepEqual(plan.domains, ["configuration"]);
  assert.deepEqual(plan.commands, ["npm run verify:full"]);
  assert.equal(plan.fallbackReasons.length, 1);
});

test("multiple source domains combine commands without duplicates", () => {
  assert.deepEqual(summary(["src/server/main.ts", "src/client/api.ts"]), {
    domains: ["client", "server"],
    commands: [
      "npm run check:client",
      "npm run check:server",
      "npm run test:client",
      "npm run test:server"
    ],
    fallbackReasons: []
  });
});

test("unknown critical files fall back to full verification", () => {
  const plan = summary(["config/runtime.json"]);
  assert.deepEqual(plan.domains, ["unknown critical"]);
  assert.deepEqual(plan.commands, ["npm run verify:full"]);
  assert.equal(plan.fallbackReasons.length, 1);
});

test("documentation-only changes run the public-tree safety check", () => {
  assert.deepEqual(summary(["docs/development-index.md"]), {
    domains: ["documentation/release"],
    commands: ["npm run check:public-tree"],
    fallbackReasons: []
  });
});

test("release documentation adds the release consistency check", () => {
  assert.deepEqual(summary(["README.md"]), {
    domains: ["documentation/release"],
    commands: ["npm run check:public-tree", "npm run check:release"],
    fallbackReasons: []
  });
});

test("service worker changes run its tests and release consistency", () => {
  assert.deepEqual(summary(["public/sw.js"]), {
    domains: ["service-worker"],
    commands: ["npm run check:release", "npm run test:service-worker"],
    fallbackReasons: []
  });
});

test("script changes run the server compiler and script tests", () => {
  assert.deepEqual(summary(["src/scripts/check-public-tree.ts"]), {
    domains: ["scripts"],
    commands: ["npm run check:server", "npm run test:scripts"],
    fallbackReasons: []
  });
});

test("GitHub workflow changes are recognized and conservatively run everything", () => {
  const plan = summary([".github/workflows/ci.yml"]);
  assert.deepEqual(plan.domains, ["GitHub workflow"]);
  assert.deepEqual(plan.commands, ["npm run verify:full"]);
  assert.equal(plan.fallbackReasons.length, 1);
});
