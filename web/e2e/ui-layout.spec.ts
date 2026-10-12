import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { resourceConfigs } from "../src/lib/resources";

async function clusterId(request: APIRequestContext) {
  const clusters = (await request
    .get("/api/clusters")
    .then((response) => response.json())) as {
    id: string;
    reachable: boolean;
  }[];
  const cluster = clusters.find((candidate) => candidate.reachable);
  expect(cluster, "a reachable test cluster is required").toBeTruthy();
  return cluster!.id;
}

async function assertLayout(page: Page) {
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(
    page.getByText("This page could not be displayed", { exact: true }),
  ).toHaveCount(0);
  // Scroll belongs to dense tables/code, never to the whole page or main viewport.
  expect(
    await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return {
        document: document.documentElement.scrollWidth - innerWidth,
        main: main.scrollWidth - main.clientWidth,
      };
    }),
  ).toEqual({ document: 0, main: 0 });
}

for (const mode of ["desktop-dark", "mobile-light"] as const) {
  test(`every registered collection and primary form has a usable ${mode} layout`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const id = await clusterId(request);
    await page.setViewportSize(
      mode === "desktop-dark"
        ? { width: 1920, height: 1080 }
        : { width: 390, height: 844 },
    );
    await page.addInitScript(
      (theme) => localStorage.setItem("astronomer-lite-theme", theme),
      mode === "desktop-dark" ? "dark" : "light",
    );
    const routes = [
      "/",
      "/settings",
      "/projects",
      "/projects/new",
      "/clusters/connect",
      `/clusters/${id}`,
      ...[
        "resources",
        "metrics",
        "events",
        "topology",
        "pods",
        "helm/releases",
        "helm/install",
        ...resourceConfigs
          .filter((resource) => resource.id !== "events")
          .map((resource) => resource.route),
      ].map((route) => `/clusters/${id}/${route}`),
    ];
    const created = await request.post("/api/projects", {
      data: {
        name: `UI layout ${mode}`,
        scopes: [{ clusterId: id, namespace: "default" }],
      },
    });
    expect(created.ok()).toBe(true);
    const project = (await created.json()) as { id: string };
    routes.push(`/projects/${project.id}`, `/projects/${project.id}/edit`);
    const pods = (await request
      .get(`/api/clusters/${id}/pods`)
      .then((response) => response.json())) as {
      name: string;
      namespace: string;
      status: string;
    }[];
    const pod = pods.find((row) => row.status === "Running");
    expect(pod).toBeTruthy();
    for (const tool of ["logs", "exec", "attach", "port-forward"])
      routes.push(
        `/clusters/${id}/pods/${pod!.namespace}/${pod!.name}/${tool}`,
      );
    routes.push(`/clusters/${id}/services/default/kubernetes/port-forward`);
    const releases = (await request
      .get(`/api/clusters/${id}/helm/releases`)
      .then((response) => response.json())) as {
      name: string;
      namespace: string;
    }[];
    if (releases.length)
      routes.push(
        `/clusters/${id}/helm/releases/${releases[0].namespace}/${releases[0].name}/upgrade`,
      );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      for (const [index, route] of routes.entries()) {
        await test.step(route, async () => {
          await page.goto(route);
          await expect(page.locator("main h1")).toBeVisible();
          await assertLayout(page);
          const label = route.split("/").at(-1) || "clusters";
          await page.screenshot({
            path: testInfo.outputPath(`${index}-${label}.png`),
            animations: "disabled",
          });
        });
      }
      expect(errors).toEqual([]);
    } finally {
      await request.delete(`/api/projects/${project.id}`);
    }
  });
}

test("resource drawers contain keyboard focus, link tabs to panels and restore focus", async ({
  page,
  request,
}) => {
  const id = await clusterId(request);
  await page.goto(`/clusters/${id}/configmaps`);
  const row = page.locator("tbody tr[tabindex]").first();
  await row.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const summary = dialog.getByRole("tab", { name: "Summary", exact: true });
  await summary.focus();
  await page.keyboard.press("End");
  await expect(
    dialog.getByRole("tab", { name: "JSON", exact: true }),
  ).toBeFocused();
  await expect(dialog.getByRole("tabpanel", { name: "JSON" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(summary).toBeFocused();
  await dialog
    .getByRole("button", { name: "Close resource detail", exact: true })
    .focus();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("dialog content remains reachable on a short mobile viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add kubeconfig", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Add kubeconfig" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Add selected", exact: true }),
  ).toBeInViewport();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(420);
  await page.screenshot({
    path: testInfo.outputPath("import-short-mobile.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("dense surfaces fill wide windows and compact density changes shared row spacing", async ({
  page,
  request,
}) => {
  const id = await clusterId(request);
  await page.setViewportSize({ width: 2560, height: 1080 });
  await page.goto(`/clusters/${id}/configmaps`);
  const content = page.locator('[data-content-layout="full-bleed"]');
  await expect(content).toBeVisible();
  expect((await content.boundingBox())!.width).toBeGreaterThan(2000);
  const cell = page.locator("tbody td:not([colspan])").first();
  await expect(cell).toBeVisible();
  const before = await cell.evaluate(
    (element) => getComputedStyle(element).paddingTop,
  );
  await page
    .getByRole("button", { name: "Compact density", exact: true })
    .click();
  expect(
    await cell.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingTop),
    ),
  ).toBeLessThan(parseFloat(before));
  await page.goto("/settings");
  expect(
    (await page.locator('[data-content-layout="contained"]').boundingBox())!
      .width,
  ).toBeLessThanOrEqual(1800);
});

test("landing page defers heavy route bundles and unknown addresses show a recovery page", async ({
  page,
}) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Clusters", exact: true }),
  ).toBeVisible();
  expect(
    scripts.filter((url) =>
      /\/(topology|metrics|yaml-editor|pod-exec)-/.test(url),
    ),
  ).toEqual([]);
  await page.goto("/unknown-page");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to clusters" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("table options stay within mobile viewport and Escape restores the trigger", async ({
  page,
  request,
}) => {
  const id = await clusterId(request);
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto(`/clusters/${id}/pods`);
  const trigger = page.getByRole("button", {
    name: "Table options",
    exact: true,
  });
  await trigger.click();
  const options = page.getByRole("dialog", { name: "Table options" });
  await expect(options).toBeVisible();
  const box = await options.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(options).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("shared query states provide loading, retry and an empty-state action", async ({
  page,
}) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects", async (route) => {
    await hold;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Workspace temporarily unavailable" }),
    });
  });
  await page.goto("/projects");
  await expect(
    page.getByRole("status", { name: "" }).filter({ hasText: "Loading" }),
  ).toBeVisible();
  release();
  await expect(page.getByRole("alert")).toContainText(
    "Workspace temporarily unavailable",
  );
  await page.unroute("**/api/projects");
  await page.route("**/api/projects", (route) => route.fulfill({ json: [] }));
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByText("No projects found.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create project", exact: true }).last(),
  ).toBeVisible();
});

test("a failed route bundle preserves navigation and presents recovery", async ({
  page,
  request,
}) => {
  const id = await clusterId(request);
  await page.route("**/assets/topology-*.js", (route) => route.abort());
  await page.goto(`/clusters/${id}/topology`);
  await expect(
    page.getByRole("heading", { name: "This page could not be displayed" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload page" })).toBeVisible();
  await page
    .getByRole("link", { name: "Back to clusters", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Clusters", exact: true }),
  ).toBeVisible();
});

test("cluster customization and event detail tabs use accessible shared overlays", async ({
  page,
  request,
}, testInfo) => {
  const id = await clusterId(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: /^Customize .* appearance$/ })
    .first()
    .click();
  const customize = page.getByRole("dialog", {
    name: "Customize cluster appearance",
  });
  await expect(customize).toBeVisible();
  await expect(
    customize.getByRole("textbox", { name: "Initials", exact: true }),
  ).toBeVisible();
  await customize
    .getByRole("button", { name: "Add link", exact: true })
    .click();
  await expect(
    customize.getByRole("textbox", { name: "Link 1 label", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("customize-mobile.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(customize).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/clusters/${id}/events`);
  const row = page.locator("tbody tr[tabindex]").first();
  await expect(row).toBeVisible();
  await row.click();
  const tablist = page.getByRole("tablist");
  await expect(tablist).toBeVisible();
  await tablist.getByRole("tab").first().focus();
  await page.keyboard.press("End");
  await expect(tablist.getByRole("tab").last()).toBeFocused();
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await expect(
    page.getByRole("separator", { name: "Resize details panel" }),
  ).toBeVisible();
});

test("long cluster names and unreachable errors fit narrow cards", async ({
  page,
}) => {
  const name = "production-" + "cluster".repeat(24);
  await page.route("**/api/clusters", (route) =>
    route.fulfill({
      json: [
        {
          id: "long-cluster",
          name,
          context: name,
          server: "https://" + "host".repeat(64),
          status: "unreachable",
          reachable: false,
          source: "managed",
          error: "Connection refused: " + "endpoint".repeat(64),
        },
      ],
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("article")).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Remove ${name}`, exact: true }),
  ).toBeVisible();
  await assertLayout(page);
});
