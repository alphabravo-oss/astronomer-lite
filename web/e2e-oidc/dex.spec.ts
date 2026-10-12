import { expect, test } from "@playwright/test";

test("real Dex login stays authenticated past ID-token expiry and local login remains available", async ({ page }) => {
 await page.goto("/");
 await page.getByRole("link", { name: "Continue with SSO" }).click();
 // Dex can display its connector chooser before the password form.
 const chooser = page.getByText("Log in with Email", { exact: true });
 if (await chooser.isVisible()) await chooser.click();
 await page.locator('input[name="login"]').fill("operator@example.test");
 await page.locator('input[name="password"]').fill("test-only-password-1234");
 await page.locator('button[type="submit"]').click();
 await expect(page).toHaveURL("http://127.0.0.1:18086/");
 await page.getByRole("link", { name: "Settings", exact: true }).click();
 await expect(page.getByText("oidc-operator", { exact: true })).toBeVisible();
 const signedInAt = Date.now();
 // Dex issues 20-second ID tokens. A successful check after 25 seconds proves
 // that the real refresh-token exchange, including rotation, kept this session.
 await expect.poll(async () => {
  if (Date.now() - signedInAt < 25_000) return false;
  const session = await page.request.get("/api/auth/session").then((r) => r.json());
  return session.user?.provider === "oidc" && session.user?.username === "oidc-operator";
 }, { timeout: 40_000, intervals: [1000] }).toBe(true);
 expect((await page.request.get("/api/clusters")).status()).toBe(200);
 await page.getByRole("button", { name: "Sign out", exact: true }).click();
 await page.getByLabel("Username", { exact: true }).fill("admin");
 await page.getByLabel("Password", { exact: true }).fill("test-only-password-1234");
 await page.getByRole("button", { name: "Sign in", exact: true }).click();
 await expect(page.getByRole("heading", { name: "Clusters", exact: true })).toBeVisible();
 const session = await page.request.get("/api/auth/session").then((r) => r.json());
 expect(session.user.provider).toBe("local");
 expect(session.user.role).toBe("admin");
});
