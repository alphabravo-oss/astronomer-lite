import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-server",
  outputDir: "./test-results-server",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:18083", trace: "retain-on-failure" },
  webServer: {
    command: "../scripts/run-server-e2e.sh",
    url: "http://127.0.0.1:18083/api/healthz",
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
