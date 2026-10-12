import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

function totp(secret: string) {
  const bits = [...secret].map((c) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", bytes).update(counter).digest();
  return String((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page: Page, username = "admin", password = "test-only-password-1234") {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clusters", exact: true })).toBeVisible();
}

test("local login keeps Lite branding and rejects invalid credentials", async ({ page, request }, testInfo) => {
  expect((await request.get("/api/clusters")).status()).toBe(401);
  await page.goto("/");
  await expect(page.getByText("Astronomer-Lite", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("login-desktop.png"), fullPage: true, animations: "disabled" });
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("invalid username or password");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("login-mobile.png"), fullPage: true, animations: "disabled" });
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeInViewport();
});

test("admin creates a local account and its session cannot see admin resources", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("operator");
  await page.getByLabel("Password", { exact: true }).fill("operator-password-1234");
  await page.getByRole("button", { name: "Save user", exact: true }).click();
  await expect(page.getByRole("cell", { name: "operator", exact: true })).toBeVisible();
  const adminSession = await page.request.get("/api/auth/session").then((r) => r.json());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await login(page, "operator", "operator-password-1234");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toHaveCount(0);
  expect((await page.request.get("/api/auth/users")).status()).toBe(403);
  expect((await page.request.patch("/api/extensions/namespace-summary", { headers: { "X-Astronomer-Lite": "1" }, data: { enabled: true } })).status()).toBe(403);
  const operatorSession = await page.request.get("/api/auth/session").then((r) => r.json());
  expect(operatorSession.user.id).not.toBe(adminSession.user.id);
});

test("plugin permissions, enable/disable and theme preferences", async ({ page, request }, testInfo) => {
  await login(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByText("list · core/namespaces")).toBeVisible();
  await page.getByRole("button", { name: "Enable Namespace summary", exact: true }).click();
  await expect(page.getByRole("button", { name: "Disable Namespace summary", exact: true })).toBeVisible();
  expect((await request.get("/api/extensions/namespace-summary/bundle")).status()).toBe(401);
  expect((await page.request.get("/api/extensions/namespace-summary/bundle")).status()).toBe(200);
  expect((await page.request.post("/api/extensions/namespace-summary/resources", { headers: { "X-Astronomer-Lite": "1" }, data: { clusterId: "unknown", verb: "list", group: "", version: "v1", resource: "secrets" } })).status()).toBe(403);
  await page.getByRole("button", { name: "Compact density", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.screenshot({ path: testInfo.outputPath("settings-dark.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath("settings-light.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Disable Namespace summary", exact: true }).click();
  expect((await page.request.get("/api/extensions/namespace-summary/bundle")).status()).toBe(403);
});

test("MFA enrollment revokes sessions and recovery codes work only once", async ({ page, browser }, testInfo) => {
  await login(page);
  expect((await page.request.post("/api/auth/users", { headers: { "X-Astronomer-Lite": "1" }, data: { username: "mfa-operator", password: "mfa-password-1234", role: "user" } })).status()).toBe(200);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await login(page, "mfa-operator", "mfa-password-1234");
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:18083" });
  try {
    const otherPage = await other.newPage();
    await login(otherPage, "mfa-operator", "mfa-password-1234");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByLabel("Password to manage MFA").fill("mfa-password-1234");
    await page.getByRole("button", { name: "Set up authenticator", exact: true }).click();
    const secret = await page.locator("code").filter({ hasText: /^[A-Z2-7]{32}$/ }).innerText();
    await page.getByLabel("New authenticator code").fill(totp(secret));
    await page.getByRole("button", { name: "Enable two-factor authentication", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
    const codes = (await page.locator("pre").innerText()).trim().split("\n");
    expect(codes).toHaveLength(8);
    expect((await other.request.get("/api/clusters")).status()).toBe(401);
    await page.getByRole("button", { name: "I have saved my codes" }).click();
    await page.screenshot({ path: testInfo.outputPath("mfa-enabled.png"), fullPage: true });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("mfa-operator");
    await page.getByLabel("Password", { exact: true }).fill("mfa-password-1234");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("authenticator or recovery code required");
    await page.getByLabel("Authenticator or recovery code (if enabled)").fill(codes[0]);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Clusters", exact: true })).toBeVisible();
    expect((await other.request.post("/api/auth/login", { headers: { "X-Astronomer-Lite": "1" }, data: { username: "mfa-operator", password: "mfa-password-1234", code: codes[0] } })).status()).toBe(401);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByLabel("Password to manage MFA").fill("mfa-password-1234");
    await page.getByLabel("Authenticator or recovery code", { exact: true }).fill(codes[1]);
    await page.getByRole("button", { name: "Disable two-factor authentication" }).click();
    await expect(page.getByText("Authenticator not enabled", { exact: true })).toBeVisible();
  } finally { await other.close(); }
});

test("signed catalog installation and updates require permission review", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Check catalog", exact: true }).click();
  const first = page.locator("article").filter({ hasText: "Signed browser test fixture" }).filter({ hasText: "1.0.0" });
  await first.getByRole("button", { name: "Review install Catalog fixture", exact: true }).click();
  await page.getByRole("button", { name: "Install package", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable Catalog fixture", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enable Catalog fixture", exact: true }).click();
  expect((await page.request.get("/api/extensions/catalog-fixture/bundle")).status()).toBe(200);
  const second = page.locator("article").filter({ hasText: "Signed browser test fixture" }).filter({ hasText: "1.1.0" });
  await second.getByRole("button", { name: "Review update Catalog fixture", exact: true }).click();
  await page.getByRole("button", { name: "Install package", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable Catalog fixture", exact: true })).toBeVisible();
  expect((await page.request.get("/api/extensions/catalog-fixture/bundle")).status()).toBe(403);
  await page.reload();
  await page.getByRole("button", { name: "Enable Catalog fixture", exact: true }).click();
  expect((await page.request.get("/api/extensions/catalog-fixture/bundle").then((r) => r.json())).html).toContain("1.1.0");
});

test("password change revokes other sessions and old password", async ({ page, browser }) => {
  await login(page);
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:18083" });
  const otherPage = await other.newPage();
  await login(otherPage);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Current password").fill("test-only-password-1234");
  await page.getByLabel("New password").fill("changed-password-1234");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Password updated");
  expect((await other.request.get("/api/clusters")).status()).toBe(401);
  await other.close();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await login(page, "admin", "changed-password-1234");
});
