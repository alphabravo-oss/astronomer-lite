import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  outputDir: process.env.E2E_BASE_URL ? `./test-results-${new URL(process.env.E2E_BASE_URL).port}` : "./test-results",
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 15_000
  },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
