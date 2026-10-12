import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Go tests cover ticket validation, response headers and the real proxy. This
// checks the actual embedded bootstrap document against browser SameSite rules.
test("remote forward bootstrap establishes Strict cookie after a cross-site link", async ({ page, context }) => {
  const bootstrap = readFileSync(new URL("../../server/internal/forward/bootstrap.html", import.meta.url), "utf8");
  await context.route("https://lite.example.com/**", route => route.fulfill({ contentType: "text/html", body: '<a href="https://random.forward.example.net/?lite_forward_ticket=test">Open forward</a>' }));
  let forwardedCookie = "";
  await context.route("https://random.forward.example.net/**", async route => {
    if (new URL(route.request().url()).searchParams.has("lite_forward_ticket")) {
      await route.fulfill({ contentType: "text/html", headers: { "Set-Cookie": "__Host-astronomer_forward=test; Path=/; Secure; HttpOnly; SameSite=Strict", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" }, body: bootstrap });
    } else {
      forwardedCookie = await route.request().headerValue("cookie") || "";
      await route.fulfill({ contentType: "text/html", body: forwardedCookie.includes("__Host-astronomer_forward=test") ? "Forwarded application" : "Unauthorized" });
    }
  });
  await page.goto("https://lite.example.com/");
  await page.getByRole("link", { name: "Open forward" }).click();
  await expect(page).toHaveURL("https://random.forward.example.net/");
  await expect(page.getByText("Forwarded application", { exact: true })).toBeVisible();
  expect(forwardedCookie).toContain("__Host-astronomer_forward=test");
  expect(await page.evaluate(() => document.cookie)).toBe("");
});
