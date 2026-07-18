import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  outputDir: "output/e2e/results",
  reporter: [
    ["line"],
    ["html", { outputFolder: "output/e2e/report", open: "never" }]
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  webServer: [
    {
      command: "npm run e2e:server",
      url: "http://127.0.0.1:3003/api/health",
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: "npm run e2e:client",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
