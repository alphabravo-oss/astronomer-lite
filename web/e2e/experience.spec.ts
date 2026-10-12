import { expect, test, type APIRequestContext } from "@playwright/test";

async function clusterAndPod(request: APIRequestContext) {
  const clusters = await request.get("/api/clusters").then((r) => r.json()) as { id: string; reachable: boolean }[];
  const cluster = clusters.find((c) => c.reachable);
  expect(cluster).toBeTruthy();
  const pods = await request.get(`/api/clusters/${cluster!.id}/pods?namespace=kube-system`).then((r) => r.json()) as { name: string; namespace: string }[];
  const pod = pods.find((p) => p.name.startsWith("coredns-"));
  expect(pod).toBeTruthy();
  return { cluster: cluster!, pod: pod! };
}

test("search opens the exact pod and its favorite returns to the same object", async ({ page, request }) => {
  const { cluster, pod } = await clusterAndPod(request);
  await page.goto(`/clusters/${cluster.id}`);
  await page.getByRole("button", { name: "Open command palette", exact: true }).click();
  await page.getByRole("combobox", { name: "Command palette search" }).fill(`/${pod.name}`);
  await page.getByRole("option").filter({ hasText: pod.name }).first().click();
  await expect(page.getByRole("heading", { name: pod.name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`name=${pod.name}`));
  await page.getByRole("button", { name: `Pin ${pod.name}`, exact: true }).click();
  await page.goto(`/clusters/${cluster.id}/deployments`);
  await page.getByRole("link", { name: new RegExp(pod.name) }).click();
  await expect(page.getByRole("heading", { name: pod.name, exact: true })).toBeVisible();
});

test("topology links open workload details and pod filtering narrows rows", async ({ page, request }, testInfo) => {
  const { cluster, pod } = await clusterAndPod(request);
  await page.goto(`/clusters/${cluster.id}/topology`);
  await page.getByLabel("Namespace", { exact: true }).selectOption("kube-system");
  await page.getByRole("link", { name: "coredns", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "coredns", exact: true })).toBeVisible();
  await page.goto(`/clusters/${cluster.id}/pods`);
  await page.getByLabel("Filter pods").fill(pod.name);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: pod.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compact density", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("pods-dark.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.screenshot({ path: testInfo.outputPath("pods-light.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("navigation-mobile.png"), fullPage: true, animations: "disabled" });
});

test("external plugin runs against the real cluster with its declared permissions", async ({ page, request }) => {
  const plugins = await request.get("/api/extensions").then((r) => r.json()) as { id: string }[];
  test.skip(!plugins.some((plugin) => plugin.id === "namespace-summary"), "Run with the example plugin directory mounted");
  const { cluster } = await clusterAndPod(request);
  expect((await request.patch("/api/extensions/namespace-summary", { data: { enabled: true } })).ok()).toBe(true);
  try {
    await page.goto(`/clusters/${cluster.id}/extensions/namespace-summary`);
    const frame = page.frameLocator('iframe[title="Namespace summary"]');
    await expect(frame.getByRole("heading", { name: "Namespace summary" })).toBeVisible();
    await expect(frame.getByText("kube-system · Active", { exact: true })).toBeVisible();
    await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
    // This plugin may list namespaces, but cannot read secrets or mutate objects.
    const forbidden = await request.post("/api/extensions/namespace-summary/resources", { data: { clusterId: cluster.id, group: "", version: "v1", resource: "secrets", verb: "list" } });
    expect(forbidden.status()).toBe(403);
  } finally { await request.patch("/api/extensions/namespace-summary", { data: { enabled: false } }); }
});

test("plugin mutations dry-run, cancel, then apply and delete with host confirmation", async ({ page, request }) => {
  const { cluster } = await clusterAndPod(request);
  const namespace = `plugin-e2e-${Date.now()}`;
  const headers = { "X-Astronomer-Lite": "1" };
  const enabled = await request.patch("/api/extensions/cluster-notes", { headers, data: { enabled: true } });
  expect(enabled.ok()).toBe(true);
  // A dedicated namespace keeps the example's fixed ConfigMap name away from user data.
  const manifest = `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n`;
  const created = await request.post(`/api/clusters/${cluster.id}/apply`, { data: manifest, headers: { "Content-Type": "application/yaml" } });
  expect(created.ok()).toBe(true);
  const objectURL = `/api/clusters/${cluster.id}/k8s/api/v1/namespaces/${namespace}/configmaps/astronomer-lite-note`;
  try {
    await page.goto(`/clusters/${cluster.id}/extensions/cluster-notes`);
    const frame = page.frameLocator('iframe[title="Cluster notes"]');
    await frame.getByLabel("Namespace", { exact: true }).fill(namespace);
    await frame.getByLabel("Note", { exact: true }).fill("A reviewed plugin change");
    await frame.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Confirm plugin change" })).toBeVisible();
    expect((await request.get(objectURL)).status()).toBe(404);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(frame.getByRole("status")).toHaveText("Change cancelled");
    expect((await request.get(objectURL)).status()).toBe(404);
    await frame.getByRole("button", { name: "Save note", exact: true }).click();
    await page.getByRole("button", { name: "Confirm change", exact: true }).click();
    await expect(frame.getByRole("status")).toHaveText("Note saved.");
    const saved = await request.get(objectURL).then((r) => r.json());
    expect(saved.data.note).toBe("A reviewed plugin change");
    await frame.getByRole("button", { name: "Delete note", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Confirm plugin change" })).toBeVisible();
    expect((await request.get(objectURL)).status()).toBe(200);
    await page.getByRole("button", { name: "Confirm change", exact: true }).click();
    await expect(frame.getByRole("status")).toHaveText("Note deleted.");
    expect((await request.get(objectURL)).status()).toBe(404);
  } finally {
    await request.patch("/api/extensions/cluster-notes", { headers, data: { enabled: false } });
    await request.delete(`/api/clusters/${cluster.id}/resources/namespaces/_/${namespace}`);
  }
});
