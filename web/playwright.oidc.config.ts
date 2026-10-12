import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
 testDir: "./e2e-oidc", outputDir: "./test-results-oidc", workers: 1,
 timeout: 90_000, expect: { timeout: 15_000 }, reporter: "list",
 use: { baseURL: "http://127.0.0.1:18086", trace: "retain-on-failure" },
 webServer: { command: "python3 ../scripts/run-oidc-e2e.py", url: "http://127.0.0.1:18086/api/healthz", reuseExistingServer: false, timeout: 90_000, gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 } },
 projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
