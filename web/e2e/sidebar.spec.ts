import { test, expect } from "@playwright/test";
import { resourceConfigs } from "../src/lib/resources";

// Navigation fixtures keep this regression independent of cluster availability.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === "/api/auth/session")
      json = { mode: "single-user", user: null, oidc: false, plugins: false };
    else if (path === "/api/version") json = { version: "test" };
    else if (path === "/api/clusters")
      json = Array.from({ length: 15 }, (_, i) => ({
        id: `cluster-${i}`,
        name: `Development ${i}`,
        context: `dev-${i}`,
        server: "https://example.invalid",
        reachable: true,
        status: "reachable",
        source: "system",
        displayColor: "blue",
        displayInitials: `D${i}`,
        links: [],
      }));
    else if (path.endsWith("/discovery"))
      json = resourceConfigs.map((resource) => ({
        group: resource.apiGroup,
        version: resource.version,
        resource: resource.resource,
        kind: resource.label,
        namespaced: resource.namespaced,
        verbs: ["list", "get"],
      }));
    else if (path.includes("/resources/"))
      json = {
        resource: path.split("/").at(-1),
        label: "Deployments",
        namespaced: true,
        items: [],
      };
    else if (path.endsWith("/dashboard"))
      json = {
        nodeCount: 1,
        podCount: 0,
        namespaceCount: 1,
        serverVersion: "test",
        conditions: {},
      };
    else if (path.endsWith("/workloads-overview"))
      return route.fulfill({
        status: 503,
        json: { error: "No metrics fixture" },
      });
    return route.fulfill({ json });
  });
});

for (const theme of ["dark", "light"]) {
  test(`collapsed cluster groups use bounded keyboard-accessible flyouts (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    await page.addInitScript(
      (value) => localStorage.setItem("astronomer-lite-theme", value),
      theme,
    );
    await page.goto("/clusters/cluster-0/pods");
    await expect(page).toHaveTitle("Astronomer Lite");
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    const toggle = sidebar.getByRole("button", { name: "Collapse sidebar" });
    expect((await toggle.boundingBox())!.y).toBeLessThan(56);
    await expect(
      sidebar.getByRole("link", { name: "Astronomer Lite home" }),
    ).toBeVisible();
    await toggle.click();
    await expect(sidebar).toHaveCSS("width", "64px");
    await expect(
      sidebar.getByRole("link", { name: "Pods", exact: true }),
    ).toHaveCount(0);
    const groups = sidebar.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(await groups.getByRole("button").count()).toBeLessThanOrEqual(8);
    const workloads = groups.getByRole("button", {
      name: "Workloads",
      exact: true,
    });
    await expect(workloads).toHaveClass(/active/);
    await workloads.focus();
    await page.keyboard.press("Enter");
    const flyout = page.getByRole("dialog", { name: "Workloads navigation" });
    await expect(flyout).toBeVisible();
    await expect(flyout.getByRole("link").first()).toBeFocused();
    const bounds = (await flyout.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(64);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
    await page.screenshot({
      path: testInfo.outputPath(`collapsed-${theme}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(flyout).toHaveCount(0);
    await expect(workloads).toBeFocused();
    await workloads.click();
    await flyout
      .getByRole("link", { name: "Deployments", exact: true })
      .click();
    await expect(page).toHaveURL(/\/deployments$/);
    await expect(flyout).toHaveCount(0);
    await page.reload();
    await expect(
      sidebar.getByRole("button", { name: "Expand sidebar" }),
    ).toBeVisible();
    await sidebar.getByRole("button", { name: "Storage", exact: true }).click();
    await page
      .getByRole("heading", { name: "Deployments", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Storage navigation" }),
    ).toHaveCount(0);
    await sidebar.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(sidebar).toHaveCSS("width", "240px");
    await expect(
      sidebar.getByRole("link", { name: "Deployments", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
}

test("workspace rail groups many clusters and mobile navigation remains expanded", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    sidebar.getByRole("link", { name: "Projects", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: "Documentation" }),
  ).toBeVisible();
  await sidebar
    .getByRole("button", { name: "Your Clusters", exact: true })
    .click();
  const flyout = page.getByRole("dialog", { name: "Your Clusters navigation" });
  await expect(flyout.getByRole("link")).toHaveCount(15);
  await expect(flyout).toHaveCSS("overflow-y", "auto");
  await flyout
    .getByRole("link", { name: "Development 14", exact: true })
    .click();
  await expect(page).toHaveURL(/\/cluster-14$/);
  await expect(flyout).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Workloads", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Workloads navigation" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("dialog", { name: "Workloads navigation" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobile = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(
    mobile.getByRole("link", { name: "Astronomer Lite home" }),
  ).toBeVisible();
  await mobile.getByRole("button", { name: "Workloads", exact: true }).click();
  await expect(
    mobile.getByRole("link", { name: "Pods", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("mobile-expanded.png"),
    animations: "disabled",
  });
  await mobile.getByRole("link", { name: "Pods", exact: true }).click();
  await expect(mobile).toHaveCount(0);
});

test("command palette keeps its last result reachable in a short window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open command palette", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const list = dialog.getByRole("listbox");
  const last = dialog.getByRole("option").last();
  await last.scrollIntoViewIfNeeded();
  const container = (await dialog.boundingBox())!;
  const row = (await last.boundingBox())!;
  expect(row.y).toBeGreaterThanOrEqual(container.y);
  expect(row.y + row.height).toBeLessThanOrEqual(
    container.y + container.height,
  );
  expect(container.y + container.height).toBeLessThanOrEqual(420);
  await expect(list).toHaveCSS("overflow-y", "auto");
  await last.click();
  await expect(dialog).toHaveCount(0);
});
