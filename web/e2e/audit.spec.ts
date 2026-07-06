// End-to-end coverage added for the functionality/parity audit follow-up.
// These cover user-facing flows the original suite skipped: the Add-cluster
// dialog (US-4), the Events page (US-11), secret reveal in the drawer, favorite
// persistence across reload, and the exec terminal UI. Runs against the same
// k3d cluster as k3d.spec.ts (Playwright workers=1, so state is serial).
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

type Cluster = {
  id: string;
  name: string;
  context: string;
  reachable: boolean;
  status?: "reachable" | "degraded" | "unreachable";
};

const stamp = Date.now();
const addContextName = `al-audit-add-${stamp}`;
const eventsPodName = `al-audit-events-${stamp}`;
const secretName = `al-audit-secret-${stamp}`;
const secretValue = `top-secret-${stamp}`;
const favoritePodName = `al-audit-fav-${stamp}`;
const execPodName = `al-audit-exec-${stamp}`;

let cleanupContext = "";
let addedClusterContext = "";

test.afterEach(async ({ request }) => {
  if (addedClusterContext) {
    const clusters = (await request.get("/api/clusters").then((r) => r.json())) as Cluster[];
    const added = clusters.find((c) => c.context === addedClusterContext);
    if (added) await request.delete(`/api/clusters/${added.id}`);
    addedClusterContext = "";
  }
  if (cleanupContext) {
    kubectl(cleanupContext, ["delete", "pod", eventsPodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "pod", favoritePodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "pod", execPodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "secret", secretName, "--ignore-not-found=true"], true);
    cleanupContext = "";
  }
});

// P2-3 (US-4): the Add-cluster dialog — paste a kubeconfig for an unreachable
// context, preview, import, and confirm it shows up unreachable.
test("adds a kubeconfig through the dialog and shows it as unreachable", async ({ page, request }) => {
  addedClusterContext = addContextName;
  const kubeconfig = fakeKubeconfig(addContextName);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Clusters" })).toBeVisible();

  await page.getByRole("button", { name: "Add kubeconfig" }).first().click();
  await page.getByLabel("Kubeconfig YAML").fill(kubeconfig);
  await page.getByRole("button", { name: "Preview contexts" }).click();

  // The context is discovered and auto-selected for import.
  await expect(page.getByText(addContextName).first()).toBeVisible();
  await page.getByRole("button", { name: "Add selected" }).click();

  // The new managed cluster appears in the list, unreachable.
  await expect(page.getByText(addContextName).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Unreachable").first()).toBeVisible({ timeout: 15_000 });

  // Confirm it was persisted via the API.
  const clusters = (await request.get("/api/clusters").then((r) => r.json())) as Cluster[];
  const added = clusters.find((c) => c.context === addContextName);
  expect(added, "added context should be registered").toBeTruthy();
  expect(added?.status).toBe("unreachable");
});

// P1-4 (US-11): the Events page renders and reflects real cluster events.
test("renders the events page with live cluster events", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, ["run", eventsPodName, "--image=busybox:1.36", "--restart=Never", "--", "sleep", "3600"]);

  await page.goto(`/clusters/${cluster.id}/events`);
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  // Scheduling/pulling/starting the pod generates events that reference it.
  await expect(page.getByText(eventsPodName).first()).toBeVisible({ timeout: 60_000 });
});

// P2-4: revealing and hiding a secret value in the resource drawer.
test("reveals and hides a secret value in the drawer", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, ["create", "secret", "generic", secretName, `--from-literal=password=${secretValue}`]);

  await page.goto(`/clusters/${cluster.id}/secrets`);
  await expect(page.getByRole("heading", { name: "Secrets" })).toBeVisible();
  await page.getByText(secretName).first().click();

  // Drawer opens with the secret masked; the plaintext is not shown yet.
  await expect(page.getByRole("button", { name: "Reveal" }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(secretValue)).toHaveCount(0);

  await page.getByRole("button", { name: "Reveal" }).first().click();
  await expect(page.getByText(secretValue)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Hide" }).first().click();
  await expect(page.getByText(secretValue)).toHaveCount(0);
});

// P2-5 (2.4): a pinned favorite persists across a full page reload.
test("favorite pin persists across reload", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  kubectl(cluster.context, ["run", favoritePodName, "--image=busybox:1.36", "--restart=Never", "--", "sleep", "3600"]);
  kubectl(cluster.context, ["wait", "--for=condition=Ready", `pod/${favoritePodName}`, "--timeout=90s"]);

  await page.goto(`/clusters/${cluster.id}/pods`);
  await expect(page.getByRole("heading", { name: "Pods" })).toBeVisible();
  await page.getByRole("row").nth(1).click();
  await page.getByRole("button", { name: /Pin [^"]+/ }).first().click();
  await expect(page.getByRole("complementary").getByText("Pinned").first()).toBeVisible({ timeout: 5_000 });

  // Reload — the pin is persisted per-cluster in localStorage and must survive.
  await page.reload();
  await expect(page.getByRole("complementary").getByText("Pinned").first()).toBeVisible({ timeout: 10_000 });
});

// P2-6 (US-13): the exec terminal page connects through the UI (not just a raw
// WebSocket), including the container picker.
test("connects an exec terminal through the UI", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  kubectl(cluster.context, ["run", execPodName, "--image=busybox:1.36", "--restart=Never", "--", "sleep", "3600"]);
  kubectl(cluster.context, ["wait", "--for=condition=Ready", `pod/${execPodName}`, "--timeout=90s"]);

  await page.goto(`/clusters/${cluster.id}/pods/default/${execPodName}/exec`);
  await expect(page.getByRole("heading", { name: execPodName })).toBeVisible();
  // The container picker is populated from pod detail.
  await expect(page.locator("select")).toBeVisible();
  // The session reaches connected (admin kubeconfig passes the RBAC preflight).
  await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 30_000 });
});

async function reachableCluster(request: APIRequestContext) {
  const clusters = (await request.get("/api/clusters").then((r) => r.json())) as Cluster[];
  const cluster = clusters.find((item) => item.reachable) ?? clusters[0];
  expect(cluster, "expected at least one kubeconfig context").toBeTruthy();
  expect(cluster.reachable, `${cluster.name} should be reachable`).toBe(true);
  return cluster;
}

function fakeKubeconfig(contextName: string) {
  return [
    "apiVersion: v1",
    "kind: Config",
    "clusters:",
    "- name: al-audit-cluster",
    "  cluster:",
    "    server: https://127.0.0.1:59999",
    "contexts:",
    `- name: ${contextName}`,
    "  context:",
    "    cluster: al-audit-cluster",
    "    user: al-audit-user",
    `current-context: ${contextName}`,
    "users:",
    "- name: al-audit-user",
    "  user:",
    "    token: al-audit-token",
    ""
  ].join("\n");
}

function kubectl(context: string, args: string[], allowFailure = false) {
  try {
    execFileSync("kubectl", ["--context", context, ...args], { env: process.env, stdio: "inherit" });
  } catch (error) {
    if (!allowFailure) throw error;
  }
}
