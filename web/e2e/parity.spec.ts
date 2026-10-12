import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

async function activeCluster(request: APIRequestContext) {
 const clusters = await request.get("/api/clusters").then((r) => r.json());
 const cluster = clusters.find((c: { reachable: boolean }) => c.reachable);
 expect(cluster).toBeTruthy(); return cluster;
}

test("upstream Headlamp UMD plugin reads pods and persists isolated settings", async ({ page, request }, testInfo) => {
 const cluster = await activeCluster(request);
 const id = "headlamp-pod-counter";
 expect((await request.patch(`/api/extensions/${id}`, { data: { enabled: true } })).status()).toBe(204);
 try {
  await page.goto(`/clusters/${cluster.id}/extensions/${id}`);
  const frame = page.frameLocator('iframe[title="Headlamp pod counter"]');
  await expect(frame.getByText(/^# Pods: [0-9]+$/)).toBeVisible();
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  await frame.getByLabel("Custom Error Message", { exact: true }).fill("My persisted plugin message");
  await expect.poll(async () => JSON.stringify(await request.get(`/api/extensions/${id}/settings`).then((r) => r.json()))).toContain("My persisted plugin message");
  await page.reload();
  await expect(frame.getByLabel("Custom Error Message", { exact: true })).toHaveValue("My persisted plugin message");
  expect((await request.post(`/api/extensions/${id}/resources`, { data: { clusterId: cluster.id, group: "", version: "v1", resource: "secrets", verb: "list" } })).status()).toBe(403);
  await page.screenshot({ path: testInfo.outputPath("headlamp-plugin.png"), fullPage: true, animations: "disabled" });
 } finally { await request.patch(`/api/extensions/${id}`, { data: { enabled: false } }); }
});

test("direct token connection retains service-account RBAC", async ({ page, request }) => {
 const original = await activeCluster(request);
 const name = "token-parity-" + Date.now();
 const kubeconfig = process.env.KUBECONFIG || "../.kube/config";
 const kubectl = (...args: string[]) => execFileSync("kubectl", ["--kubeconfig", kubeconfig, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
 let imported = "";
 try {
  kubectl("create", "namespace", name);
  kubectl("-n", name, "create", "serviceaccount", name);
  kubectl("create", "clusterrolebinding", name, "--clusterrole=view", `--serviceaccount=${name}:${name}`);
  const token = kubectl("-n", name, "create", "token", name, "--duration=10m").trim();
  const config = JSON.parse(kubectl("config", "view", "--raw", "-o", "json"));
  const source = config.clusters.find((c: { cluster: { server: string } }) => c.cluster.server === original.server).cluster;
  await page.goto("/clusters/connect");
  await page.getByLabel("Connection name", { exact: true }).fill(name);
  await page.getByLabel("Kubernetes API URL", { exact: true }).fill(original.server);
  await page.getByLabel("Bearer token", { exact: true }).fill(token);
  await page.getByLabel("Cluster CA certificate (PEM, optional)", { exact: true }).fill(Buffer.from(source["certificate-authority-data"], "base64").toString());
  await page.getByRole("button", { name: "Review connection", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Confirm connection" })).toBeVisible();
  await page.getByRole("button", { name: "Connect cluster", exact: true }).click();
  await expect(page).toHaveURL(/\/clusters\/(?!connect)[a-f0-9]+$/);
  imported = new URL(page.url()).pathname.split("/")[2];
  expect((await request.get(`/api/clusters/${imported}/pods`)).status()).toBe(200);
  const denied = await request.post(`/api/clusters/${imported}/can-i`, { data: { group: "apps", resource: "deployments", namespace: name, verb: "create" } }).then((r) => r.json());
  expect(denied.allowed).toBe(false);
  expect(page.url()).not.toContain(token);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(token);
 } finally {
  if (imported) await request.delete(`/api/clusters/${imported}`);
  kubectl("delete", "clusterrolebinding", name, "--ignore-not-found");
  kubectl("delete", "namespace", name, "--ignore-not-found", "--wait=false");
 }
});

test("table views preserve columns, export filtered rows, and support keyboard navigation", async ({ page, request }, testInfo) => {
 const cluster = await activeCluster(request);
 await page.goto(`/clusters/${cluster.id}/pods`);
 await page.getByLabel("Filter pods").fill("coredns");
 await expect(page.getByRole("button", { name: /^coredns-/ }).first()).toBeVisible();
 await page.getByRole("button", { name: "Table options", exact: true }).click();
 await page.getByLabel("Show Node", { exact: true }).uncheck();
 await page.getByLabel("Pin Name", { exact: true }).check();
 await page.getByLabel("Name column width", { exact: true }).fill("350");
 await page.getByLabel("View name").fill("DNS view");
 await page.getByRole("button", { name: "Save view", exact: true }).click();
 await page.getByRole("button", { name: "Close table options", exact: true }).click();
 await expect(page.getByRole("columnheader", { name: "Node", exact: true })).toHaveCount(0);
 const header = page.getByRole("columnheader", { name: "Name", exact: true });
 await expect(header).toHaveCSS("position", "sticky");
 await expect(header).toHaveCSS("width", "350px");
 await page.reload();
 await page.getByLabel("Saved table view").selectOption("DNS view");
 await expect(page.getByLabel("Filter pods")).toHaveValue("coredns");
 await expect(page.getByRole("columnheader", { name: "Node", exact: true })).toHaveCount(0);
 const download = page.waitForEvent("download");
 await page.getByRole("button", { name: "Export CSV", exact: true }).click();
 const file = await download; const path = await file.path();
 expect(path).toBeTruthy();
 const csv = readFileSync(path!, "utf8");
 expect(csv).toContain('"Name","Namespace"'); expect(csv).toContain("coredns"); expect(csv).not.toContain('"Node"');
 await page.screenshot({ path: testInfo.outputPath("table-saved-view.png"), fullPage: true });
 const row = page.locator("tbody tr[tabindex]").first();
 await row.focus(); await page.keyboard.press("Enter");
 await expect(page.getByRole("heading", { name: /^coredns-/ })).toBeVisible();
});

test("Helm chart upload previews without writing, then installs and upgrades", async ({ page, request }) => {
 const cluster = await activeCluster(request);
 const namespace = "helm-parity-" + Date.now();
 const folder = mkdtempSync(join(tmpdir(), "lite-helm-parity-"));
 const chart = join(folder, "tiny");
 mkdirSync(join(chart, "templates"), { recursive: true });
 writeFileSync(join(chart, "values.yaml"), "message: default\n");
 writeFileSync(join(chart, "templates", "configmap.yaml"), 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}\ndata:\n  message: {{ .Values.message | quote }}\n');
 function archive(version: string) {
  writeFileSync(join(chart, "Chart.yaml"), "apiVersion: v2\nname: tiny\nversion: " + version + "\n");
  execFileSync("helm", ["package", chart, "--destination", folder], { stdio: "pipe" });
  return join(folder, "tiny-" + version + ".tgz");
 }
 const first = archive("0.1.0"); const second = archive("0.2.0");
 const objectURL = `/api/clusters/${cluster.id}/k8s/api/v1/namespaces/${namespace}/configmaps/parity`;
 try {
  await page.goto(`/clusters/${cluster.id}/helm/install`);
  await page.getByLabel("Upload a packaged chart").check();
  await page.getByLabel("Chart archive (.tgz)", { exact: true }).setInputFiles(first);
  await page.getByLabel("Release name", { exact: true }).fill("parity");
  await page.getByLabel("Namespace", { exact: true }).fill(namespace);
  await page.getByLabel("Create namespace if needed").check();
  await page.getByLabel("Values overrides (YAML)").fill("message: installed\n");
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review deployment" })).toBeVisible();
  expect((await request.get(objectURL)).status()).toBe(404);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await request.get(objectURL)).status()).toBe(404);
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await page.getByRole("button", { name: "Confirm install", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/helm/releases$"));
  expect((await request.get(objectURL).then((r) => r.json())).data.message).toBe("installed");
  await page.goto(`/clusters/${cluster.id}/helm/releases/${namespace}/parity/upgrade`);
  await page.getByLabel("Upload a packaged chart").check();
  await page.getByLabel("Chart archive (.tgz)", { exact: true }).setInputFiles(second);
  await expect(page.getByLabel("Values overrides (YAML)")).toHaveValue(/installed/);
  await page.getByLabel("Values overrides (YAML)").fill("message: upgraded\n");
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review deployment" })).toBeVisible();
  expect((await request.get(objectURL).then((r) => r.json())).data.message).toBe("installed");
  await page.getByRole("button", { name: "Confirm upgrade", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/helm/releases$"));
  expect((await request.get(objectURL).then((r) => r.json())).data.message).toBe("upgraded");
  const release = await request.get(`/api/clusters/${cluster.id}/helm/releases/${namespace}/parity`).then((r) => r.json());
  expect(release.version).toBe("0.2.0"); expect(release.revision).toBe(2);
  const rejected = await request.post(`/api/clusters/${cluster.id}/helm/upgrade`, { data: { name: "parity", namespace, archive: readFileSync(first).toString("base64"), values: "message: rejected", digest: "wrong", dryRun: false } });
  expect(rejected.status()).toBe(409);
  expect((await request.get(objectURL).then((r) => r.json())).data.message).toBe("upgraded");
 } finally {
  await request.delete(`/api/clusters/${cluster.id}/helm/releases/${namespace}/parity`);
  await request.delete(`/api/clusters/${cluster.id}/resources/namespaces/_/${namespace}`);
  rmSync(folder, { recursive: true, force: true });
 }
});

test("projects persist scopes, show resources and access, export, edit, and delete", async ({ page, request }) => {
 const cluster = await activeCluster(request);
 const name = "Project parity " + Date.now();
 let id = "";
 try {
  await page.goto("/");
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("link", { name: "Create project", exact: true }).first().click();
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Description", { exact: true }).fill("Scoped Kubernetes workspace");
  await page.getByLabel("Cluster", { exact: true }).selectOption(cluster.id);
  await page.getByLabel("Namespace", { exact: true }).fill("kube-system");
  await page.getByRole("button", { name: "Add scope", exact: true }).click();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  id = page.url().split("/projects/")[1];
  const original = await request.get("/api/projects/" + id).then((r) => r.json());
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await page.getByPlaceholder("Search project resources").fill("coredns");
  await expect(page.getByRole("link", { name: "coredns", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Access", exact: true }).click();
  await expect(page.getByText(/Pod listing allowed/)).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".react-flow")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export YAML", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("project.yaml");
  await page.getByRole("link", { name: "Edit project", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Updated scope");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByText("Updated scope", { exact: true })).toBeVisible();
  expect((await request.put("/api/projects/" + id, { data: original })).status()).toBe(409);
  await page.getByRole("button", { name: "Delete project", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete project", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect((await request.get("/api/projects/" + id)).status()).toBe(404);
 } finally { if (id) await request.delete("/api/projects/" + id); }
});
