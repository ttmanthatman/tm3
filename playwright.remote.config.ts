import { defineConfig, devices } from "@playwright/test";
import { remoteE2EEnvironment } from "./e2e-remote/safety.js";

const remote = remoteE2EEnvironment();

export default defineConfig({
  testDir: "./e2e-remote",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  outputDir: "output/e2e-remote/results",
  reporter: [["line"], ["html", { outputFolder: "output/e2e-remote/report", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: remote.baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  }
});
