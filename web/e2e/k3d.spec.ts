import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

type Cluster = {
  id: string;
  name: string;
  context: string;
  server: string;
  source: "system" | "managed";
  reachable: boolean;
  status?: "reachable" | "degraded" | "unreachable";
  version?: string;
  error?: string;
};

type PortForward = {
  id: string;
  url: string;
};

type MetricsResponse = {
  available: boolean;
  nodes?: unknown[];
  pods?: unknown[];
  error?: string;
};

const deploymentName = `al-e2e-watch-${Date.now()}`;
const dashboardPodName = `al-e2e-dashboard-${Date.now()}`;
const actionDeploymentName = `al-e2e-actions-${Date.now()}`;
const workloadDrawerDeploymentName = `al-e2e-workload-${Date.now()}`;
const portForwardPodName = `al-e2e-tray-${Date.now()}`;
const logPodName = `al-e2e-logs-${Date.now()}`;
const reconnectLogPodName = `al-e2e-log-reconnect-${Date.now()}`;
const execPodName = `al-e2e-exec-${Date.now()}`;
const attachPodName = `al-e2e-attach-${Date.now()}`;
const reconnectWatchConfigMapName = `al-e2e-watch-reconnect-${Date.now()}`;
const applyConfigMapOne = `al-e2e-apply-one-${Date.now()}`;
const applyConfigMapTwo = `al-e2e-apply-two-${Date.now()}`;
const namespaceFilterName = `al-e2e-ns-${Date.now()}`;
const namespaceFilterPodName = `al-e2e-ns-pod-${Date.now()}`;
const readPagesPodName = `al-e2e-read-${Date.now()}`;
const readPagesServiceName = `al-e2e-svc-${Date.now()}`;
const readPagesConfigMapName = `al-e2e-config-${Date.now()}`;
const readPagesServiceAccountName = `al-e2e-sa-${Date.now()}`;
const readPagesRoleName = `al-e2e-role-${Date.now()}`;
const readPagesNetworkPolicyName = `al-e2e-netpol-${Date.now()}`;
const pdbDeploymentName = `al-e2e-pdb-${Date.now()}`;
const pdbName = `al-e2e-pdb-${Date.now()}`;
const parityDeploymentName = `al-e2e-parity-${Date.now()}`;
const hpaName = `al-e2e-hpa-${Date.now()}`;
const ingressClassName = `al-e2e-ingress-class-${Date.now()}`;
const resourceQuotaName = `al-e2e-quota-${Date.now()}`;
const limitRangeName = `al-e2e-limits-${Date.now()}`;
const leaseName = `al-e2e-lease-${Date.now()}`;
const customResourceName = `al-e2e-widget-${Date.now()}`;
const customResourcePlural = "widgets";
const customResourceGroup = "e2e.astronomer.io";
const customResourceDefinitionName = `${customResourcePlural}.${customResourceGroup}`;
const backendTLSPolicyName = `al-e2e-backend-tls-${Date.now()}`;
const backendTrafficPolicyName = `al-e2e-backend-traffic-${Date.now()}`;
const backendTLSPolicyCRDName = "backendtlspolicies.gateway.networking.k8s.io";
const backendTrafficPolicyCRDName = "xbackendtrafficpolicies.gateway.networking.x-k8s.io";
const helmReleaseName = `al-e2e-helm-${Date.now()}`;
const helmChartDir = `/tmp/al-e2e-tiny-chart-${Date.now()}`;
const workloadRollbackDeploymentName = `al-e2e-rollback-${Date.now()}`;
const workloadRollbackUiName = `al-e2e-rollback-ui-${Date.now()}`;
const helmReleaseUiName = `al-e2e-helm-ui-${Date.now()}`;
const helmReleaseUninstallName = `al-e2e-helm-uninst-${Date.now()}`;
const helmChartUiDir = `/tmp/al-e2e-tiny-chart-ui-${Date.now()}`;
let cleanupContext = "";
let cleanupClusterId = "";
let cleanupPortForwardIds: string[] = [];
let cleanupTLSPolicyCRD = false;
let cleanupTrafficPolicyCRD = false;
let cleanupHelmRelease = false;

test.afterEach(async ({ request }) => {
  for (const sessionId of cleanupPortForwardIds) {
    if (cleanupClusterId) {
      await request.delete(`/api/clusters/${cleanupClusterId}/portforwards/${encodeURIComponent(sessionId)}`);
    }
  }
  if (cleanupContext) {
    kubectl(cleanupContext, ["delete", "deployment", deploymentName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "deployment", actionDeploymentName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "deployment", workloadDrawerDeploymentName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "poddisruptionbudget", pdbName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "deployment", pdbDeploymentName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "horizontalpodautoscaler", hpaName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "deployment", parityDeploymentName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "ingressclass", ingressClassName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "resourcequota", resourceQuotaName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "limitrange", limitRangeName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "lease", leaseName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "pod", dashboardPodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "pod", portForwardPodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "pod", logPodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "pod", reconnectLogPodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "pod", execPodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "pod", attachPodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "pod", readPagesPodName, "--ignore-not-found=true", "--grace-period=0", "--force"], true);
    kubectl(cleanupContext, ["delete", "namespace", namespaceFilterName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "service", readPagesServiceName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "configmap", readPagesConfigMapName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "serviceaccount", readPagesServiceAccountName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "role", readPagesRoleName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "networkpolicy", readPagesNetworkPolicyName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "configmap", applyConfigMapOne, applyConfigMapTwo, reconnectWatchConfigMapName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "backendtlspolicy.gateway.networking.k8s.io", backendTLSPolicyName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "xbackendtrafficpolicy.gateway.networking.x-k8s.io", backendTrafficPolicyName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", `${customResourcePlural}.${customResourceGroup}`, customResourceName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "crd", customResourceDefinitionName, "--ignore-not-found=true"], true);
    if (cleanupTLSPolicyCRD) {
      kubectl(cleanupContext, ["delete", "crd", backendTLSPolicyCRDName, "--ignore-not-found=true"], true);
    }
    if (cleanupTrafficPolicyCRD) {
      kubectl(cleanupContext, ["delete", "crd", backendTrafficPolicyCRDName, "--ignore-not-found=true"], true);
    }
    kubectl(cleanupContext, ["delete", "deployment", workloadRollbackDeploymentName, "--ignore-not-found=true"], true);
    kubectl(cleanupContext, ["delete", "deployment", workloadRollbackUiName, "--ignore-not-found=true"], true);
    if (cleanupHelmRelease) {
      for (const releaseName of [helmReleaseName, helmReleaseUiName, helmReleaseUninstallName]) {
        try {
          execFileSync("helm", ["--kube-context", cleanupContext, "uninstall", releaseName, "--namespace", "default"], { stdio: "ignore" });
        } catch {
          // Already cleaned up or never installed.
        }
      }
    }
  }
  cleanupClusterId = "";
  cleanupContext = "";
  cleanupPortForwardIds = [];
  cleanupTLSPolicyCRD = false;
  cleanupTrafficPolicyCRD = false;
  cleanupHelmRelease = false;
});

test("reports reachable and unreachable kubeconfig contexts", async ({ page, request }) => {
  const clusters = await request.get("/api/clusters").then((response) => response.json() as Promise<Cluster[]>);
  const reachable = clusters.find((item) => item.reachable);
  expect(reachable, "expected a reachable k3d kubeconfig context").toBeTruthy();
  expect(reachable).toMatchObject({
    source: "system",
    status: "reachable",
    reachable: true
  });
  expect(reachable?.version, "reachable cluster should include server version").toBeTruthy();

  const expectedUnreachableContext = process.env.EXPECT_UNREACHABLE_CONTEXT;
  if (expectedUnreachableContext) {
    const unreachable = clusters.find((item) => item.context === expectedUnreachableContext);
    expect(unreachable, `expected ${expectedUnreachableContext} to be loaded from KUBECONFIG`).toBeTruthy();
    expect(unreachable).toMatchObject({
      source: "system",
      status: "unreachable",
      reachable: false
    });
    expect(unreachable?.error, "unreachable cluster should include the probe error").toBeTruthy();
  }

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Clusters" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: reachable?.name })).toBeVisible();
  if (expectedUnreachableContext) {
    await expect(page.getByText(expectedUnreachableContext).first()).toBeVisible();
    await expect(page.getByText("Unreachable").first()).toBeVisible();
  }
});

test("discovers a kubeconfig cluster and streams deployment watch updates", async ({ page, request }) => {
  const clusters = await request.get("/api/clusters").then((response) => response.json() as Promise<Cluster[]>);
  const cluster = clusters.find((item) => item.reachable) ?? clusters[0];
  expect(cluster, "expected at least one kubeconfig context").toBeTruthy();
  expect(cluster.reachable, `${cluster.name} should be reachable`).toBe(true);
  cleanupContext = cluster.context;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Clusters" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: cluster.name })).toBeVisible();

  await page.goto(`/clusters/${cluster.id}`);
  await expect(page.getByRole("heading", { name: cluster.name })).toBeVisible();
  await expect(page.getByText("api server")).toBeVisible();
  await expect(page.getByRole("link", { name: "View pods" })).toBeVisible();

  await page.getByRole("button", { name: "Workloads" }).click();
  await page.getByRole("link", { name: "Pods", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pods" })).toBeVisible();
  await expect(page.getByText(/Watch: (connected|connecting)/)).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/deployments`);
  await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  await expect(page.getByText("Watch: connected")).toBeVisible();

  kubectl(cluster.context, ["create", "deployment", deploymentName, "--image=nginx:1.27-alpine"]);
  await expect(page.getByText(deploymentName)).toBeVisible({ timeout: 1_000 });

  kubectl(cluster.context, ["delete", "deployment", deploymentName]);
  await expect(page.getByText(deploymentName)).toHaveCount(0, { timeout: 1_000 });
});

test("loads dashboard metrics and the pods page for a real cluster", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, ["run", dashboardPodName, "--image=busybox:1.36", "--restart=Never", "--", "sleep", "3600"]);
  kubectl(cluster.context, ["wait", "--for=condition=Ready", `pod/${dashboardPodName}`, "--timeout=90s"]);

  await page.goto(`/clusters/${cluster.id}`);
  await expect(page.getByRole("heading", { name: cluster.name })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("Nodes", { exact: true })).toBeVisible();
  await expect(main.getByText("Pods", { exact: true })).toBeVisible();
  await expect(main.getByText("Namespaces", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Node conditions" })).toBeVisible();
  await expect(page.getByText(/Ready: [1-9]/)).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/pods`);
  await expect(page.getByRole("heading", { name: "Pods" })).toBeVisible();
  await expect(page.getByText(dashboardPodName)).toBeVisible({ timeout: 2_000 });
});

test("filters pods by namespace and persists the selection per cluster", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, ["create", "namespace", namespaceFilterName]);
  kubectl(cluster.context, [
    "run",
    namespaceFilterPodName,
    "--namespace",
    namespaceFilterName,
    "--image=busybox:1.36",
    "--restart=Never",
    "--",
    "sleep",
    "3600"
  ]);
  kubectl(cluster.context, ["wait", "--namespace", namespaceFilterName, "--for=condition=Ready", `pod/${namespaceFilterPodName}`, "--timeout=90s"]);

  await page.goto(`/clusters/${cluster.id}/pods`);
  await expect(page.getByRole("heading", { name: "Pods" })).toBeVisible();
  await expect(page.getByText(namespaceFilterPodName)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "All namespaces" }).click();
  await expect(page.getByText("Namespaces", { exact: true }).first()).toBeVisible();
  const namespaceOption = page.locator("label").filter({ hasText: namespaceFilterName });
  await namespaceOption.locator('input[name="namespace-filter"]').check();

  await expect(page.getByRole("button", { name: "1 namespaces" })).toBeVisible();
  await expect(page.getByText(`Filtered to ${namespaceFilterName}.`)).toBeVisible();
  await expect(page.getByText(namespaceFilterPodName)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), `namespaces:${cluster.id}`))
    .toBe(JSON.stringify([namespaceFilterName]));

  await page.reload();
  await expect(page.getByRole("button", { name: "1 namespaces" })).toBeVisible();
  await expect(page.getByText(`Filtered to ${namespaceFilterName}.`)).toBeVisible();
  await expect(page.getByText(namespaceFilterPodName)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "1 namespaces" }).click();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("button", { name: "All namespaces" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), `namespaces:${cluster.id}`)).toBe("[]");
});

test("scales and deletes a deployment from the resource drawer", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, ["create", "deployment", actionDeploymentName, "--image=nginx:1.27-alpine"]);
  await page.goto(`/clusters/${cluster.id}/deployments`);
  await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  await expect(page.getByText(actionDeploymentName)).toBeVisible({ timeout: 30_000 });

  await page.getByText(actionDeploymentName).click();
  await expect(page.getByRole("heading", { name: actionDeploymentName })).toBeVisible();
  await page.locator(`#replicas-${actionDeploymentName}`).fill("2");
  await page.getByRole("button", { name: "Scale" }).click();
  await expect(page.getByText("Scaled to 2 replicas.")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => kubectlOutput(cluster.context, ["get", "deployment", actionDeploymentName, "-o", "jsonpath={.spec.replicas}"])).toBe("2");

  await page.locator(`#delete-${actionDeploymentName}`).fill(actionDeploymentName);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(actionDeploymentName)).toHaveCount(0, { timeout: 30_000 });
  expect(kubectlOutput(cluster.context, ["get", "deployment", actionDeploymentName, "--ignore-not-found=true"])).toBe("");
});

test("displays workload drawer pods, container spec, and revision history", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, ["create", "deployment", workloadDrawerDeploymentName, "--image=nginx:1.27-alpine"]);
  kubectl(cluster.context, ["rollout", "status", `deployment/${workloadDrawerDeploymentName}`, "--timeout=90s"]);
  kubectl(cluster.context, ["set", "image", `deployment/${workloadDrawerDeploymentName}`, "*=nginx:1.26-alpine"]);
  kubectl(cluster.context, ["rollout", "status", `deployment/${workloadDrawerDeploymentName}`, "--timeout=90s"]);

  await page.goto(`/clusters/${cluster.id}/deployments`);
  await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  await expect(page.getByText(workloadDrawerDeploymentName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(workloadDrawerDeploymentName).click();

  await expect(page.getByRole("heading", { name: workloadDrawerDeploymentName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workload", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Replicas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Owned Pods" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Container Spec" })).toBeVisible();
  await expect(page.getByText("nginx:1.26-alpine", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revision History" })).toBeVisible();
  await expect(page.getByText("Current").first()).toBeVisible();
  await expect(page.getByText("Previous").first()).toBeVisible();
});

test("lists active port-forwards in the topbar tray and stops them", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupClusterId = cluster.id;
  cleanupContext = cluster.context;

  kubectl(cluster.context, [
    "run",
    portForwardPodName,
    "--image=busybox:1.36",
    "--restart=Never",
    `--labels=app=${portForwardPodName}`,
    "--",
    "/bin/sh",
    "-c",
    "while true; do printf 'HTTP/1.1 200 OK\\r\\nContent-Length: 14\\r\\n\\r\\nAL_E2E_TRAY_OK' | nc -l -p 8080; done"
  ]);
  kubectl(cluster.context, ["wait", "--for=condition=Ready", `pod/${portForwardPodName}`, "--timeout=90s"]);

  const startResponse = await request.post(`/api/clusters/${cluster.id}/portforwards`, {
    data: {
      namespace: "default",
      pod: portForwardPodName,
      remotePort: 8080,
      localPort: 0
    }
  });
  expect(startResponse.ok()).toBe(true);
  const session = (await startResponse.json()) as PortForward;
  cleanupPortForwardIds.push(session.id);

  const forwardedResponse = await request.get(session.url);
  expect(await forwardedResponse.text()).toBe("AL_E2E_TRAY_OK");

  await page.goto(`/clusters/${cluster.id}`);
  await page.getByRole("button", { name: "Active port-forwards" }).click();
  await expect(page.getByRole("heading", { name: "Port-forwards" })).toBeVisible();
  await expect(page.getByRole("link", { name: portForwardPodName })).toBeVisible();
  await expect(page.getByRole("link", { name: session.url })).toBeVisible();
  await expect(page.getByText("8080/TCP")).toBeVisible();
  await expect(page.getByText(/Expires in/)).toBeVisible();

  await page.getByRole("button", { name: `Stop ${portForwardPodName} port-forward` }).click();
  cleanupPortForwardIds = cleanupPortForwardIds.filter((id) => id !== session.id);
  await expect(page.getByText("No active port-forwards for this cluster.")).toBeVisible();
  const remainingResponse = await request.get(`/api/clusters/${cluster.id}/portforwards`);
  expect(await remainingResponse.json()).toEqual([]);
});

test("dry-runs and applies multiple YAML documents", async ({ request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  const manifest = [
    configMapManifest(applyConfigMapOne, "one"),
    configMapManifest(applyConfigMapTwo, "two")
  ].join("\n---\n");

  const dryRunResponse = await request.post(`/api/clusters/${cluster.id}/apply?dryRun=true`, {
    data: manifest,
    headers: { "Content-Type": "application/yaml" }
  });
  expect(dryRunResponse.ok()).toBe(true);
  const dryRun = await dryRunResponse.json();
  expect(dryRun).toMatchObject({
    dryRun: true,
    items: [
      { kind: "ConfigMap", namespace: "default", name: applyConfigMapOne, dryRun: true },
      { kind: "ConfigMap", namespace: "default", name: applyConfigMapTwo, dryRun: true }
    ]
  });
  expect(kubectlOutput(cluster.context, ["get", "configmap", applyConfigMapOne, "--ignore-not-found=true"])).toBe("");

  const applyResponse = await request.post(`/api/clusters/${cluster.id}/apply`, {
    data: manifest,
    headers: { "Content-Type": "application/yaml" }
  });
  expect(applyResponse.ok()).toBe(true);
  const applied = await applyResponse.json();
  expect(applied).toMatchObject({
    dryRun: false,
    items: [
      { kind: "ConfigMap", namespace: "default", name: applyConfigMapOne, dryRun: false },
      { kind: "ConfigMap", namespace: "default", name: applyConfigMapTwo, dryRun: false }
    ]
  });
  expect(kubectlOutput(cluster.context, ["get", "configmap", applyConfigMapOne, applyConfigMapTwo, "-o", "name"])).toContain(`configmap/${applyConfigMapOne}`);
});

test("streams pod logs in real time", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, [
    "run",
    logPodName,
    "--image=busybox:1.36",
    "--restart=Never",
    `--labels=app=${logPodName}`,
    "--",
    "/bin/sh",
    "-c",
    "i=0; while true; do echo AL_E2E_LOG_$i; i=$((i+1)); sleep 1; done"
  ]);
  kubectl(cluster.context, ["wait", "--for=condition=Ready", `pod/${logPodName}`, "--timeout=90s"]);

  await page.goto(`/clusters/${cluster.id}/pods/default/${logPodName}/logs`);
  await expect(page.getByRole("heading", { name: logPodName })).toBeVisible();
  await expect(page.getByText(/connected|reconnecting/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/AL_E2E_LOG_/)).toBeVisible({ timeout: 30_000 });
});

test("resumes pod logs after transient disconnect without replaying lines", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, [
    "run",
    reconnectLogPodName,
    "--image=busybox:1.36",
    "--restart=Never",
    `--labels=app=${reconnectLogPodName}`,
    "--",
    "/bin/sh",
    "-c",
    "i=0; while true; do echo AL_E2E_RECONNECT_LOG_$i; i=$((i+1)); sleep 1; done"
  ]);
  kubectl(cluster.context, ["wait", "--for=condition=Ready", `pod/${reconnectLogPodName}`, "--timeout=90s"]);

  await page.goto(`/clusters/${cluster.id}`);
  const first = await collectLogFrames(page, cluster.id, reconnectLogPodName, "", 3);
  const latest = first.reduce((max, frame) => (frame.timestamp > max ? frame.timestamp : max), "");
  await page.waitForTimeout(2500);
  const second = await collectLogFrames(page, cluster.id, reconnectLogPodName, latest, 2);
  const seen = new Set(first.map((frame) => `${frame.timestamp}\u0000${frame.message}`));
  const duplicates = second.filter((frame) => seen.has(`${frame.timestamp}\u0000${frame.message}`));
  const nonIncreasing = second.filter((frame) => frame.timestamp <= latest);

  expect(latest).not.toBe("");
  expect(duplicates).toEqual([]);
  expect(nonIncreasing).toEqual([]);
  expect(second.map((frame) => frame.message).join("\n")).toContain("AL_E2E_RECONNECT_LOG_");
});

test("attaches to a running pod container", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectlApply(
    cluster.context,
    `apiVersion: v1
kind: Pod
metadata:
  name: ${attachPodName}
  namespace: default
spec:
  restartPolicy: Never
  containers:
    - name: ${attachPodName}
      image: busybox:1.36
      command: ["/bin/sh", "-c", "cat"]
      stdin: true
      tty: true`
  );
  kubectl(cluster.context, ["wait", "--for=condition=Ready", `pod/${attachPodName}`, "--timeout=90s"]);

  await page.goto(`/clusters/${cluster.id}`);
  const frames = await attachAndEcho(page, cluster.id, attachPodName, "AL_E2E_ATTACH_OK");
  expect(frames.map((frame) => frame.message ?? "").join("\n")).toContain("AL_E2E_ATTACH_OK");
});

test("executes a command in a running pod container", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, ["run", execPodName, "--image=busybox:1.36", "--restart=Never", "--", "sleep", "3600"]);
  kubectl(cluster.context, ["wait", "--for=condition=Ready", `pod/${execPodName}`, "--timeout=90s"]);

  await page.goto(`/clusters/${cluster.id}`);
  const frames = await execCommand(page, cluster.id, execPodName, ["ls", "/"]);
  const output = frames.map((frame) => frame.message ?? "").join("");
  expect(output).toContain("bin");
  expect(output).toContain("etc");

  const topFrames = await execInteractiveCommand(page, cluster.id, execPodName, ["top"], ["Mem:", "CPU:", "PID"]);
  const topOutput = topFrames.map((frame) => frame.message ?? "").join("");
  expect(topOutput).toMatch(/Mem:|CPU:|PID/);
});

test("resource watch reconnects after a transient disconnect", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  await page.goto(`/clusters/${cluster.id}`);
  const first = await collectWatchFrames(page, cluster.id, "", 1);
  expect(first.length).toBeGreaterThan(0);

  const secondPromise = collectWatchFrames(page, cluster.id, reconnectWatchConfigMapName, 1);
  await page.waitForTimeout(500);
  kubectl(cluster.context, ["create", "configmap", reconnectWatchConfigMapName, "--from-literal=message=reconnected"]);
  const second = await secondPromise;

  expect(second).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "ADDED",
        object: expect.objectContaining({
          metadata: expect.objectContaining({
            name: reconnectWatchConfigMapName,
            namespace: "default"
          })
        })
      })
    ])
  );
});

test("displays pod disruption budget policy details", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, ["create", "deployment", pdbDeploymentName, "--image=nginx:1.27-alpine"]);
  kubectl(cluster.context, ["create", "poddisruptionbudget", pdbName, "--selector", `app=${pdbDeploymentName}`, "--min-available=1"]);

  await page.goto(`/clusters/${cluster.id}/poddisruptionbudgets`);
  await expect(page.getByRole("heading", { name: "PDB" })).toBeVisible();
  await expect(page.getByText(pdbName)).toBeVisible({ timeout: 30_000 });

  await page.getByText(pdbName).click();
  await expect(page.getByRole("heading", { name: pdbName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pod Disruption Budget" })).toBeVisible();
  await expect(page.getByText("Min Available")).toBeVisible();
  await expect(page.getByText("Disruptions Allowed")).toBeVisible();
  await expect(page.getByText(`app=${pdbDeploymentName}`)).toBeVisible();
});

test("displays discovered custom resource instances with summary fields", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectlApply(cluster.context, customResourceDefinitionManifest());
  kubectl(cluster.context, ["wait", "--for=condition=Established", `crd/${customResourceDefinitionName}`, "--timeout=60s"]);
  kubectlApply(cluster.context, customResourceManifest(customResourceName));

  await page.goto(`/clusters/${cluster.id}/resources?q=${customResourcePlural}`);
  await expect(page.getByRole("heading", { name: "Widget" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(customResourceName)).toBeVisible({ timeout: 30_000 });

  await page.getByText(customResourceName).click();
  await expect(page.getByRole("heading", { name: customResourceName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Custom Resource" })).toBeVisible();
  await expect(page.getByText(customResourceGroup, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spec" })).toBeVisible();
  await expect(page.getByText("tier", { exact: true })).toBeVisible();
  await expect(page.getByText("gold", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conditions" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Accepted", exact: true })).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/crds`);
  await expect(page.getByRole("heading", { name: "CRDs" })).toBeVisible();
  await page.getByPlaceholder(/Filter/).fill(customResourcePlural);
  await expect(page.getByText(customResourceDefinitionName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(customResourceDefinitionName).click();
  await expect(page.getByRole("heading", { name: customResourceDefinitionName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Additional Printer Columns" })).toBeVisible();
  await expect(page.getByText(".spec.tier", { exact: true })).toBeVisible();
  await expect(page.getByText("Desired replicas", { exact: true })).toBeVisible();
});

test("displays gateway policy resource details", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  const tlsCrdExists = kubectlOutput(cluster.context, ["get", "crd", backendTLSPolicyCRDName, "--ignore-not-found=true"]) !== "";
  const trafficCrdExists = kubectlOutput(cluster.context, ["get", "crd", backendTrafficPolicyCRDName, "--ignore-not-found=true"]) !== "";
  if (!tlsCrdExists) {
    kubectlApply(cluster.context, backendTLSPolicyCRDManifest());
    cleanupTLSPolicyCRD = true;
  }
  if (!trafficCrdExists) {
    kubectlApply(cluster.context, backendTrafficPolicyCRDManifest());
    cleanupTrafficPolicyCRD = true;
  }
  kubectl(cluster.context, ["wait", "--for=condition=Established", `crd/${backendTLSPolicyCRDName}`, "--timeout=60s"]);
  kubectl(cluster.context, ["wait", "--for=condition=Established", `crd/${backendTrafficPolicyCRDName}`, "--timeout=60s"]);

  kubectlApply(cluster.context, backendTLSPolicyManifest(backendTLSPolicyName));
  kubectlApply(cluster.context, backendTrafficPolicyManifest(backendTrafficPolicyName));

  await page.goto(`/clusters/${cluster.id}/backendtlspolicies`);
  await expect(page.getByRole("heading", { name: "BackendTLSPolicies" })).toBeVisible();
  await expect(page.getByText(backendTLSPolicyName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(backendTLSPolicyName).click();
  await expect(page.getByRole("heading", { name: backendTLSPolicyName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backend TLS Policy" })).toBeVisible();
  await expect(page.getByText("service.default.svc.cluster.local", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Target Refs" })).toBeVisible();
  await expect(page.getByText("backend-service", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CA Certificate Refs" })).toBeVisible();
  await expect(page.getByText("backend-ca", { exact: true })).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/xbackendtrafficpolicies`);
  await expect(page.getByRole("heading", { name: "XBackendTrafficPolicies" })).toBeVisible();
  await expect(page.getByText(backendTrafficPolicyName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(backendTrafficPolicyName).click();
  await expect(page.getByRole("heading", { name: backendTrafficPolicyName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backend Traffic Policy" })).toBeVisible();
  await expect(page.getByText("25% / 10s")).toBeVisible();
  await expect(page.getByText("5 / 1s")).toBeVisible();
  await expect(page.getByText("sticky-service")).toBeVisible();
});

test("displays storage, networking, and security read page details", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, [
    "run",
    readPagesPodName,
    "--image=busybox:1.36",
    "--restart=Never",
    `--labels=app=${readPagesPodName}`,
    "--",
    "sleep",
    "3600"
  ]);
  kubectl(cluster.context, ["wait", "--for=condition=Ready", `pod/${readPagesPodName}`, "--timeout=90s"]);
  kubectl(cluster.context, ["expose", "pod", readPagesPodName, "--name", readPagesServiceName, "--port=80", "--target-port=8080"]);
  kubectl(cluster.context, ["create", "configmap", readPagesConfigMapName, "--from-literal=mode=read-pages"]);
  kubectl(cluster.context, ["create", "serviceaccount", readPagesServiceAccountName]);
  kubectl(cluster.context, ["create", "role", readPagesRoleName, "--verb=get,list", "--resource=pods"]);
  kubectlApply(cluster.context, networkPolicyManifest(readPagesNetworkPolicyName, readPagesPodName));

  await page.goto(`/clusters/${cluster.id}/services`);
  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  await expect(page.getByText(readPagesServiceName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(readPagesServiceName).click();
  await expect(page.getByRole("heading", { name: readPagesServiceName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Service", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ports" })).toBeVisible();
  await expect(page.getByText("80 -> 8080")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Endpoints" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Endpoint Slices" })).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/configmaps`);
  await expect(page.getByRole("heading", { name: "ConfigMaps" })).toBeVisible();
  await expect(page.getByText(readPagesConfigMapName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(readPagesConfigMapName).click();
  await expect(page.getByRole("heading", { name: readPagesConfigMapName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data" })).toBeVisible();
  await expect(page.getByText("read-pages")).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/serviceaccounts`);
  await expect(page.getByRole("heading", { name: "ServiceAccounts" })).toBeVisible();
  await expect(page.getByText(readPagesServiceAccountName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(readPagesServiceAccountName).click();
  await expect(page.getByRole("heading", { name: readPagesServiceAccountName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Service Account" })).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/roles`);
  await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
  await expect(page.getByText(readPagesRoleName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(readPagesRoleName).click();
  await expect(page.getByRole("heading", { name: readPagesRoleName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  await expect(page.getByText("pods")).toBeVisible();
  await expect(page.getByText("get, list")).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/networkpolicies`);
  await expect(page.getByRole("heading", { name: "Network Policies" })).toBeVisible();
  await expect(page.getByText(readPagesNetworkPolicyName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(readPagesNetworkPolicyName).click();
  await expect(page.getByRole("heading", { name: readPagesNetworkPolicyName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Network Policy" })).toBeVisible();
  await expect(page.getByText("Ingress", { exact: true })).toBeVisible();
  await expect(page.getByText(`app=${readPagesPodName}`, { exact: true })).toBeVisible();
});

test("renders metrics page when metrics-server is present or absent", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  const response = await request.get(`/api/clusters/${cluster.id}/metrics`);
  expect(response.ok()).toBe(true);
  const metrics = (await response.json()) as MetricsResponse;

  await page.goto(`/clusters/${cluster.id}/metrics`);
  await expect(page.getByRole("heading", { name: "Metrics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Node usage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top pods by CPU" })).toBeVisible();

  if (metrics.available) {
    await expect(page.getByText("metrics-server").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Node CPU" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top Pod CPU" })).toBeVisible();
  } else {
    await expect(page.getByText("optional")).toBeVisible();
    await expect(page.getByText(/metrics-server is not available for this cluster/)).toBeVisible();
    await expect(page.getByText("No node metrics found.")).toBeVisible();
    await expect(page.getByText("No pod metrics found.")).toBeVisible();
  }
});

test("displays built-in Headlamp parity resource details", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;

  kubectl(cluster.context, ["create", "deployment", parityDeploymentName, "--image=nginx:1.27-alpine"]);
  kubectl(cluster.context, ["autoscale", "deployment", parityDeploymentName, "--name", hpaName, "--min=1", "--max=3", "--cpu-percent=50"]);
  kubectlApply(cluster.context, ingressClassManifest(ingressClassName));
  kubectl(cluster.context, ["create", "quota", resourceQuotaName, "--hard=pods=10,requests.cpu=1,requests.memory=1Gi"]);
  kubectlApply(cluster.context, limitRangeManifest(limitRangeName));
  kubectlApply(cluster.context, leaseManifest(leaseName));

  await page.goto(`/clusters/${cluster.id}/ingressclasses`);
  await expect(page.getByRole("heading", { name: "IngressClasses" })).toBeVisible();
  await expect(page.getByText(ingressClassName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(ingressClassName).click();
  await expect(page.getByRole("heading", { name: ingressClassName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ingress Class" })).toBeVisible();
  await expect(page.getByText("example.com/ingress-controller", { exact: true })).toBeVisible();
  await expect(page.getByText("IngressParameters / default-params / Cluster")).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/horizontalpodautoscalers`);
  await expect(page.getByRole("heading", { name: "HPAs" })).toBeVisible();
  await expect(page.getByText(hpaName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(hpaName).click();
  await expect(page.getByRole("heading", { name: hpaName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Horizontal Pod Autoscaler" })).toBeVisible();
  await expect(page.getByText(`Deployment/${parityDeploymentName}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Metrics" })).toBeVisible();
  await expect(page.getByText("Utilization / 50%")).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/resourcequotas`);
  await expect(page.getByRole("heading", { name: "ResourceQuotas" })).toBeVisible();
  await expect(page.getByText(resourceQuotaName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(resourceQuotaName).click();
  await expect(page.getByRole("heading", { name: resourceQuotaName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resource Quota" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
  await expect(page.getByText("requests.cpu", { exact: true })).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/limitranges`);
  await expect(page.getByRole("heading", { name: "LimitRanges" })).toBeVisible();
  await expect(page.getByText(limitRangeName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(limitRangeName).click();
  await expect(page.getByRole("heading", { name: limitRangeName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Limit Range" })).toBeVisible();
  await expect(page.getByText("cpu: 50m, memory: 64Mi")).toBeVisible();
  await expect(page.getByText("cpu: 100m, memory: 64Mi")).toBeVisible();

  await page.goto(`/clusters/${cluster.id}/leases`);
  await expect(page.getByRole("heading", { name: "Leases" })).toBeVisible();
  await expect(page.getByText(leaseName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(leaseName).click();
  await expect(page.getByRole("heading", { name: leaseName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lease", exact: true })).toBeVisible();
  await expect(page.getByText("astronomer-lite-e2e", { exact: true })).toBeVisible();
  await expect(page.getByText("30s", { exact: true })).toBeVisible();
});

test("opens the command palette and navigates to pods", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  await page.goto(`/clusters/${cluster.id}`);
  await page.locator("body").click();
  await page.keyboard.press("Control+k");
  const input = page.getByLabel("Command palette search");
  await expect(input).toBeVisible();
  await input.fill("Open Pods");
  const option = page.getByRole("option").filter({ hasText: /^Open Pods/ }).first();
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
  await expect(page.getByRole("heading", { name: "Pods" })).toBeVisible();
});

test("global search returns cluster resources through the palette", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  await page.goto(`/clusters/${cluster.id}`);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Type a command or search...").fill("/coredns");
  // CoreDNS ships with k3d in kube-system; either the deployment or pod should match.
  await expect(page.getByRole("option", { name: /coredns/ }).first()).toBeVisible({ timeout: 15_000 });
});

test("exposes the OpenAPI schema endpoint", async ({ request }) => {
  const cluster = await reachableCluster(request);
  const response = await request.get(`/api/clusters/${cluster.id}/openapi`);
  expect(response.ok()).toBe(true);
  const doc = (await response.json()) as { swagger?: string; definitions?: Record<string, unknown> };
  expect(doc.swagger).toBe("2.0");
  expect(Object.keys(doc.definitions ?? {}).length).toBeGreaterThan(100);
  expect(doc.definitions?.["io.k8s.api.apps.v1.Deployment"]).toBeTruthy();
});

test("rolls back a Deployment to a previous revision", async ({ request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  kubectl(cluster.context, ["create", "deployment", workloadRollbackDeploymentName, "--image=nginx:1.27-alpine"]);
  kubectl(cluster.context, ["rollout", "status", `deployment/${workloadRollbackDeploymentName}`, "--timeout=120s"]);
  kubectl(cluster.context, ["set", "image", `deployment/${workloadRollbackDeploymentName}`, "nginx=nginx:1.26-alpine"]);
  kubectl(cluster.context, ["rollout", "status", `deployment/${workloadRollbackDeploymentName}`, "--timeout=120s"]);
  const before = kubectlOutput(cluster.context, ["get", "deployment", workloadRollbackDeploymentName, "-o", "jsonpath={.spec.template.spec.containers[0].image}"]);
  expect(before).toBe("nginx:1.26-alpine");
  const response = await request.post(`/api/clusters/${cluster.id}/resources/deployments/default/${workloadRollbackDeploymentName}/rollback`, {
    data: { revision: 1 }
  });
  expect(response.ok()).toBe(true);
  await expect
    .poll(() => kubectlOutput(cluster.context, ["get", "deployment", workloadRollbackDeploymentName, "-o", "jsonpath={.spec.template.spec.containers[0].image}"]))
    .toBe("nginx:1.27-alpine");
});

test("lists, rolls back, and renders Helm releases", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  // Write a tiny self-contained chart that doesn't pull any images.
  execFileSync("mkdir", ["-p", `${helmChartDir}/templates`]);
  execFileSync("sh", ["-c", `cat > ${helmChartDir}/Chart.yaml <<'YAML'
apiVersion: v2
name: tiny
version: 0.1.0
appVersion: "v1"
YAML`]);
  execFileSync("sh", ["-c", `cat > ${helmChartDir}/values.yaml <<'YAML'
greeting: hello
YAML`]);
  execFileSync("sh", ["-c", `cat > ${helmChartDir}/templates/configmap.yaml <<'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${helmReleaseName}-greeting
data:
  message: {{ .Values.greeting | quote }}
YAML`]);
  execFileSync("helm", ["--kube-context", cluster.context, "install", helmReleaseName, helmChartDir, "--namespace", "default"], { stdio: "inherit" });
  cleanupHelmRelease = true;
  execFileSync("helm", ["--kube-context", cluster.context, "upgrade", helmReleaseName, helmChartDir, "--namespace", "default", "--set", "greeting=world"], { stdio: "inherit" });

  // Server-side list contains the release at revision 2.
  const list = (await request.get(`/api/clusters/${cluster.id}/helm/releases`).then((r) => r.json())) as Array<{ name: string; revision: number; namespace: string }>;
  const release = list.find((item) => item.name === helmReleaseName);
  expect(release, "helm release should appear in /api/clusters/{id}/helm/releases").toBeTruthy();
  expect(release?.revision).toBe(2);

  // History returns two entries.
  const history = (await request.get(`/api/clusters/${cluster.id}/helm/releases/default/${helmReleaseName}/history`).then((r) => r.json())) as Array<{ revision: number }>;
  expect(history.length).toBeGreaterThanOrEqual(2);

  // Rollback to revision 1 and verify the ConfigMap value changes back.
  const rollback = await request.post(`/api/clusters/${cluster.id}/helm/releases/default/${helmReleaseName}/rollback`, { data: { revision: 1 } });
  expect(rollback.ok()).toBe(true);
  await expect
    .poll(() => kubectlOutput(cluster.context, ["get", "cm", `${helmReleaseName}-greeting`, "-o", "jsonpath={.data.message}"]))
    .toBe("hello");

  // UI smoke: page renders and shows the release row.
  await page.goto(`/clusters/${cluster.id}/helm/releases`);
  await expect(page.getByRole("heading", { name: "Helm Releases" })).toBeVisible();
  await expect(page.getByText(helmReleaseName).first()).toBeVisible({ timeout: 15_000 });
});

test("rolls back a Deployment from the workload drawer UI", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  kubectl(cluster.context, ["create", "deployment", workloadRollbackUiName, "--image=nginx:1.27-alpine"]);
  kubectl(cluster.context, ["rollout", "status", `deployment/${workloadRollbackUiName}`, "--timeout=120s"]);
  kubectl(cluster.context, ["set", "image", `deployment/${workloadRollbackUiName}`, "nginx=nginx:1.26-alpine"]);
  kubectl(cluster.context, ["rollout", "status", `deployment/${workloadRollbackUiName}`, "--timeout=120s"]);

  await page.goto(`/clusters/${cluster.id}/deployments`);
  await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  await expect(page.getByText(workloadRollbackUiName)).toBeVisible({ timeout: 30_000 });
  await page.getByText(workloadRollbackUiName).click();
  await expect(page.getByRole("heading", { name: "Revision History" })).toBeVisible();

  const revision1Row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "1", exact: true }) }).first();
  await revision1Row.getByRole("button", { name: /Roll back to revision 1/i }).click();
  await expect(page.getByText(/Rolled back to revision 1\./)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => kubectlOutput(cluster.context, ["get", "deployment", workloadRollbackUiName, "-o", "jsonpath={.spec.template.spec.containers[0].image}"]))
    .toBe("nginx:1.27-alpine");
});

test("rolls back a Helm release from the UI", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  writeTinyHelmChart(helmChartUiDir, helmReleaseUiName);
  execFileSync("helm", ["--kube-context", cluster.context, "install", helmReleaseUiName, helmChartUiDir, "--namespace", "default"], { stdio: "inherit" });
  cleanupHelmRelease = true;
  execFileSync("helm", ["--kube-context", cluster.context, "upgrade", helmReleaseUiName, helmChartUiDir, "--namespace", "default", "--set", "greeting=world"], { stdio: "inherit" });

  await page.goto(`/clusters/${cluster.id}/helm/releases`);
  await expect(page.getByRole("heading", { name: "Helm Releases" })).toBeVisible();
  await page.getByText(helmReleaseUiName).first().click();
  await expect(page.getByRole("heading", { name: "Revision History" })).toBeVisible();
  await page.getByRole("button", { name: "Roll back" }).first().click();
  await expect(page.getByText(/Rolled back to revision 1\./)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => kubectlOutput(cluster.context, ["get", "cm", `${helmReleaseUiName}-greeting`, "-o", "jsonpath={.data.message}"]))
    .toBe("hello");
});

test("uninstalls a Helm release from the UI", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  writeTinyHelmChart(helmChartUiDir, helmReleaseUninstallName);
  execFileSync("helm", ["--kube-context", cluster.context, "install", helmReleaseUninstallName, helmChartUiDir, "--namespace", "default"], { stdio: "inherit" });
  cleanupHelmRelease = true;

  await page.goto(`/clusters/${cluster.id}/helm/releases`);
  await expect(page.getByRole("heading", { name: "Helm Releases" })).toBeVisible();
  await page.getByText(helmReleaseUninstallName).first().click();
  // The drawer's Uninstall trigger opens the confirm dialog.
  await page.getByRole("button", { name: "Uninstall" }).first().click();
  // Confirm dialog input is id'd uniquely; the dialog's confirm button is the second "Uninstall" in DOM order.
  await page.locator("#confirm-dialog-value").fill(helmReleaseUninstallName);
  await page.getByRole("button", { name: "Uninstall" }).last().click();
  await expect(page.getByText(helmReleaseUninstallName)).toHaveCount(0, { timeout: 30_000 });
});

test("lists clusters with workload-overview rollup tiles", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  const response = await request.get(`/api/clusters/${cluster.id}/workloads-overview`);
  expect(response.ok()).toBe(true);
  const overview = (await response.json()) as { pods: { total: number }; failing: unknown[] };
  expect(overview.pods.total).toBeGreaterThan(0);
  expect(Array.isArray(overview.failing)).toBe(true);
  await page.goto(`/clusters/${cluster.id}`);
  await expect(page.getByRole("heading", { name: "Workload health" })).toBeVisible({ timeout: 15_000 });
});

test("topology endpoint returns a graph and the page renders nodes", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  const response = await request.get(`/api/clusters/${cluster.id}/topology?namespace=kube-system`);
  expect(response.ok()).toBe(true);
  const graph = (await response.json()) as { nodes: unknown[]; edges: unknown[] };
  expect(graph.nodes.length).toBeGreaterThan(0);
  await page.goto(`/clusters/${cluster.id}/topology`);
  await expect(page.getByRole("heading", { name: "Topology" })).toBeVisible();
  await page.getByLabel("Namespace").fill("kube-system");
  await expect(page.getByText(/\d+ nodes · \d+ edges/)).toBeVisible({ timeout: 15_000 });
});

test("prometheus detect endpoint reports a result", async ({ request }) => {
  const cluster = await reachableCluster(request);
  const response = await request.get(`/api/clusters/${cluster.id}/prom/detect`);
  expect(response.ok()).toBe(true);
  const result = (await response.json()) as { available: boolean; reason?: string };
  // Stock k3d doesn't have Prometheus, but the endpoint must still answer.
  expect(typeof result.available).toBe("boolean");
});

test("cluster links round-trip through the PATCH endpoint", async ({ request }) => {
  const cluster = await reachableCluster(request);
  const setResponse = await request.patch(`/api/clusters/${cluster.id}/links`, {
    data: { links: [{ label: "Grafana", url: "https://grafana.example.com" }] }
  });
  expect(setResponse.ok()).toBe(true);
  const updated = (await setResponse.json()) as { links: Array<{ label: string }> };
  expect(updated.links.map((link) => link.label)).toContain("Grafana");
  // Reset to keep state clean for subsequent tests.
  const resetResponse = await request.patch(`/api/clusters/${cluster.id}/links`, { data: { links: [] } });
  expect(resetResponse.ok()).toBe(true);
});

test("favorites star toggle in the resource drawer adds a sidebar pin", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  await page.goto(`/clusters/${cluster.id}/pods`);
  await expect(page.getByRole("heading", { name: "Pods" })).toBeVisible();
  // Click the first pod row to open the drawer.
  await page.getByRole("row").nth(1).click();
  const pinButton = page.getByRole("button", { name: /Pin [^"]+/ }).first();
  await pinButton.click();
  await expect(page.getByRole("complementary").getByText("Pinned").first()).toBeVisible({ timeout: 5_000 });
});

test("pod logs Pin-to-dock button adds and removes a dock entry", async ({ page, request }) => {
  const cluster = await reachableCluster(request);
  cleanupContext = cluster.context;
  // Use the already-existing coredns pod from kube-system for a known target.
  const podsResponse = await request.get(`/api/clusters/${cluster.id}/pods`);
  const pods = (await podsResponse.json()) as Array<{ name: string; namespace: string }>;
  const coredns = pods.find((p) => p.namespace === "kube-system" && p.name.startsWith("coredns"));
  expect(coredns, "expected a coredns pod to exist on k3d").toBeTruthy();
  await page.goto(`/clusters/${cluster.id}/pods/${encodeURIComponent(coredns!.namespace)}/${encodeURIComponent(coredns!.name)}/logs`);
  await expect(page.getByRole("heading", { name: coredns!.name })).toBeVisible();
  await page.getByRole("button", { name: "Pin to dock" }).click();
  await expect(page.getByText("Dock")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Unpin" }).click();
});

function writeTinyHelmChart(dir: string, releaseName: string) {
  execFileSync("rm", ["-rf", dir]);
  execFileSync("mkdir", ["-p", `${dir}/templates`]);
  execFileSync("sh", ["-c", `cat > ${dir}/Chart.yaml <<'YAML'
apiVersion: v2
name: tiny
version: 0.1.0
appVersion: "v1"
YAML`]);
  execFileSync("sh", ["-c", `cat > ${dir}/values.yaml <<'YAML'
greeting: hello
YAML`]);
  execFileSync("sh", ["-c", `cat > ${dir}/templates/configmap.yaml <<'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${releaseName}-greeting
data:
  message: {{ .Values.greeting | quote }}
YAML`]);
}

async function reachableCluster(request: APIRequestContext) {
  const clusters = await request.get("/api/clusters").then((response) => response.json() as Promise<Cluster[]>);
  const cluster = clusters.find((item) => item.reachable) ?? clusters[0];
  expect(cluster, "expected at least one kubeconfig context").toBeTruthy();
  expect(cluster.reachable, `${cluster.name} should be reachable`).toBe(true);
  return cluster;
}

type LogFrame = {
  type: "line" | "error" | "end";
  message: string;
  timestamp: string;
};

type ExecFrame = {
  type: "stdout" | "stderr" | "error" | "end";
  message?: string;
};

async function collectLogFrames(page: { evaluate: <T, A>(pageFunction: (arg: A) => Promise<T>, arg: A) => Promise<T> }, clusterId: string, podName: string, sinceTime: string, minLines: number) {
  return page.evaluate(
    ({ clusterId, podName, sinceTime, minLines }) =>
      new Promise<LogFrame[]>((resolve, reject) => {
        const params = new URLSearchParams({
          ns: "default",
          pod: podName,
          container: podName,
          tailLines: "3",
          follow: "true",
          timestamps: "true"
        });
        if (sinceTime) params.set("sinceTime", sinceTime);
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/clusters/${clusterId}/ws/logs?${params.toString()}`);
        const frames: LogFrame[] = [];
        const timer = window.setTimeout(() => {
          ws.close();
          reject(new Error("Timed out collecting log frames"));
        }, 12_000);
        ws.onmessage = (event) => {
          const frame = JSON.parse(event.data) as LogFrame;
          if (frame.type === "error") {
            window.clearTimeout(timer);
            ws.close();
            reject(new Error(frame.message || "Log stream failed"));
            return;
          }
          if (frame.type === "line") {
            frames.push(frame);
            if (frames.length >= minLines) {
              window.clearTimeout(timer);
              ws.close();
              resolve(frames);
            }
          }
        };
        ws.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error("Log WebSocket failed"));
        };
      }),
    { clusterId, podName, sinceTime, minLines }
  );
}

type WatchFrame = {
  type: "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK" | "ERROR" | "RESET";
  object?: {
    metadata?: {
      name?: string;
      namespace?: string;
    };
  };
  message?: string;
};

async function collectWatchFrames(page: { evaluate: <T, A>(pageFunction: (arg: A) => Promise<T>, arg: A) => Promise<T> }, clusterId: string, name: string, minFrames: number) {
  return page.evaluate(
    ({ clusterId, name, minFrames }) =>
      new Promise<WatchFrame[]>((resolve, reject) => {
        const params = new URLSearchParams({
          group: "",
          version: "v1",
          resource: "configmaps",
          kind: "ConfigMap",
          namespaced: "true",
          namespace: "default"
        });
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/clusters/${clusterId}/ws/watch?${params.toString()}`);
        const frames: WatchFrame[] = [];
        const timer = window.setTimeout(() => {
          ws.close();
          reject(new Error("Timed out collecting watch frames"));
        }, 15_000);
        ws.onmessage = (event) => {
          const frame = JSON.parse(event.data) as WatchFrame;
          if (frame.type === "ERROR") {
            window.clearTimeout(timer);
            ws.close();
            reject(new Error(frame.message || "Watch stream failed"));
            return;
          }
          if (frame.type === "BOOKMARK") return;
          if (!name || frame.object?.metadata?.name === name) {
            frames.push(frame);
          }
          if (frames.length >= minFrames) {
            window.clearTimeout(timer);
            ws.close();
            resolve(frames);
          }
        };
        ws.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error("Watch WebSocket failed"));
        };
      }),
    { clusterId, name, minFrames }
  );
}

async function attachAndEcho(page: { evaluate: <T, A>(pageFunction: (arg: A) => Promise<T>, arg: A) => Promise<T> }, clusterId: string, podName: string, message: string) {
  return page.evaluate(
    ({ clusterId, podName, message }) =>
      new Promise<ExecFrame[]>((resolve, reject) => {
        const params = new URLSearchParams({
          ns: "default",
          pod: podName,
          container: podName
        });
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/clusters/${clusterId}/ws/attach?${params.toString()}`);
        const frames: ExecFrame[] = [];
        const timer = window.setTimeout(() => {
          ws.close();
          reject(new Error("Timed out waiting for attach echo"));
        }, 15_000);
        ws.onopen = () => {
          ws.send(new TextEncoder().encode(`${message}\n`));
        };
        ws.onmessage = (event) => {
          const frame = JSON.parse(event.data) as ExecFrame;
          frames.push(frame);
          if ((frame.message ?? "").includes(message)) {
            window.clearTimeout(timer);
            ws.close();
            resolve(frames);
          }
          if (frame.type === "error") {
            window.clearTimeout(timer);
            ws.close();
            reject(new Error(frame.message || "Attach stream failed"));
          }
        };
        ws.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error("Attach WebSocket failed"));
        };
      }),
    { clusterId, podName, message }
  );
}

async function execCommand(page: { evaluate: <T, A>(pageFunction: (arg: A) => Promise<T>, arg: A) => Promise<T> }, clusterId: string, podName: string, command: string[]) {
  return page.evaluate(
    ({ clusterId, podName, command }) =>
      new Promise<ExecFrame[]>((resolve, reject) => {
        const params = new URLSearchParams({
          ns: "default",
          pod: podName,
          container: podName
        });
        for (const part of command) params.append("command", part);
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/clusters/${clusterId}/ws/exec?${params.toString()}`);
        const frames: ExecFrame[] = [];
        const timer = window.setTimeout(() => {
          ws.close();
          reject(new Error(`Timed out waiting for exec command: ${command.join(" ")}`));
        }, 15_000);
        ws.onmessage = (event) => {
          const frame = JSON.parse(event.data) as ExecFrame;
          frames.push(frame);
          if (frame.type === "error") {
            window.clearTimeout(timer);
            ws.close();
            reject(new Error(frame.message || "Exec stream failed"));
            return;
          }
          if (frame.type === "end") {
            window.clearTimeout(timer);
            ws.close();
            resolve(frames);
          }
        };
        ws.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error("Exec WebSocket failed"));
        };
      }),
    { clusterId, podName, command }
  );
}

async function execInteractiveCommand(
  page: { evaluate: <T, A>(pageFunction: (arg: A) => Promise<T>, arg: A) => Promise<T> },
  clusterId: string,
  podName: string,
  command: string[],
  expectedOutput: string[]
) {
  return page.evaluate(
    ({ clusterId, podName, command, expectedOutput }) =>
      new Promise<ExecFrame[]>((resolve, reject) => {
        const params = new URLSearchParams({
          ns: "default",
          pod: podName,
          container: podName
        });
        for (const part of command) params.append("command", part);
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/clusters/${clusterId}/ws/exec?${params.toString()}`);
        const frames: ExecFrame[] = [];
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          callback();
        };
        const timer = window.setTimeout(() => {
          ws.close();
          finish(() => reject(new Error(`Timed out waiting for interactive exec command: ${command.join(" ")}`)));
        }, 15_000);
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
        };
        ws.onmessage = (event) => {
          const frame = JSON.parse(event.data) as ExecFrame;
          frames.push(frame);
          if (frame.type === "error") {
            ws.close();
            finish(() => reject(new Error(frame.message || "Interactive exec stream failed")));
            return;
          }
          const output = frames.map((item) => item.message ?? "").join("");
          if (expectedOutput.some((expected) => output.includes(expected))) {
            ws.send(new TextEncoder().encode("q"));
            ws.close();
            finish(() => resolve(frames));
          }
        };
        ws.onerror = () => {
          finish(() => reject(new Error("Interactive exec WebSocket failed")));
        };
      }),
    { clusterId, podName, command, expectedOutput }
  );
}

function configMapManifest(name: string, message: string) {
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}
  namespace: default
data:
  message: ${message}`;
}

function networkPolicyManifest(name: string, appLabel: string) {
  return `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${name}
  namespace: default
spec:
  podSelector:
    matchLabels:
      app: ${appLabel}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector: {}`;
}

function customResourceDefinitionManifest() {
  return `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: ${customResourceDefinitionName}
spec:
  group: ${customResourceGroup}
  scope: Namespaced
  names:
    plural: ${customResourcePlural}
    singular: widget
    kind: Widget
    shortNames:
      - wgt
  versions:
    - name: v1alpha1
      served: true
      storage: true
      additionalPrinterColumns:
        - name: Tier
          type: string
          jsonPath: .spec.tier
          description: Desired service tier
        - name: Replicas
          type: integer
          jsonPath: .spec.replicas
          description: Desired replicas
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                tier:
                  type: string
                replicas:
                  type: integer
            status:
              type: object
              x-kubernetes-preserve-unknown-fields: true`;
}

function customResourceManifest(name: string) {
  return `apiVersion: ${customResourceGroup}/v1alpha1
kind: Widget
metadata:
  name: ${name}
  namespace: default
spec:
  tier: gold
  replicas: 3
status:
  conditions:
    - type: Accepted
      status: "True"
      reason: E2E
      message: Widget accepted by Astronomer-lite e2e
      lastTransitionTime: "2026-01-01T00:00:00Z"`;
}

function backendTLSPolicyCRDManifest() {
  return `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: ${backendTLSPolicyCRDName}
  annotations:
    api-approved.kubernetes.io: "https://github.com/kubernetes-sigs/gateway-api/pull/2378"
spec:
  group: gateway.networking.k8s.io
  scope: Namespaced
  names:
    plural: backendtlspolicies
    singular: backendtlspolicy
    kind: BackendTLSPolicy
  versions:
    - name: v1alpha3
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          x-kubernetes-preserve-unknown-fields: true`;
}

function backendTrafficPolicyCRDManifest() {
  return `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: ${backendTrafficPolicyCRDName}
spec:
  group: gateway.networking.x-k8s.io
  scope: Namespaced
  names:
    plural: xbackendtrafficpolicies
    singular: xbackendtrafficpolicy
    kind: XBackendTrafficPolicy
  versions:
    - name: v1alpha1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          x-kubernetes-preserve-unknown-fields: true`;
}

function backendTLSPolicyManifest(name: string) {
  return `apiVersion: gateway.networking.k8s.io/v1alpha3
kind: BackendTLSPolicy
metadata:
  name: ${name}
  namespace: default
spec:
  targetRefs:
    - group: ""
      kind: Service
      name: backend-service
      sectionName: https
  validation:
    hostname: service.default.svc.cluster.local
    caCertificateRefs:
      - group: ""
        kind: ConfigMap
        name: backend-ca`;
}

function backendTrafficPolicyManifest(name: string) {
  return `apiVersion: gateway.networking.x-k8s.io/v1alpha1
kind: XBackendTrafficPolicy
metadata:
  name: ${name}
  namespace: default
spec:
  targetRefs:
    - group: ""
      kind: Service
      name: backend-service
      sectionName: http
  retryConstraint:
    budget:
      percent: 25
      interval: 10s
    minRetryRate:
      count: 5
      interval: 1s
  sessionPersistence:
    type: Cookie
    cookieName: sticky-service`;
}

function ingressClassManifest(name: string) {
  return `apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: ${name}
  annotations:
    ingressclass.kubernetes.io/is-default-class: "false"
spec:
  controller: example.com/ingress-controller
  parameters:
    apiGroup: example.com
    kind: IngressParameters
    name: default-params
    scope: Cluster`;
}

function limitRangeManifest(name: string) {
  return `apiVersion: v1
kind: LimitRange
metadata:
  name: ${name}
  namespace: default
spec:
  limits:
    - type: Container
      min:
        cpu: 50m
        memory: 64Mi
      max:
        cpu: "1"
        memory: 512Mi
      default:
        cpu: 250m
        memory: 128Mi
      defaultRequest:
        cpu: 100m
        memory: 64Mi`;
}

function leaseManifest(name: string) {
  return `apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: ${name}
  namespace: default
spec:
  holderIdentity: astronomer-lite-e2e
  leaseDurationSeconds: 30
  leaseTransitions: 1
  acquireTime: "2026-01-01T00:00:00.000000Z"
  renewTime: "2026-01-01T00:01:00.000000Z"`;
}

function kubectlOutput(context: string, args: string[]) {
  return execFileSync("kubectl", ["--context", context, ...args], {
    env: process.env,
    encoding: "utf8"
  }).trim();
}

function kubectl(context: string, args: string[], allowFailure = false) {
  try {
    execFileSync("kubectl", ["--context", context, ...args], {
      env: process.env,
      stdio: "inherit"
    });
  } catch (error) {
    if (!allowFailure) throw error;
  }
}

function kubectlApply(context: string, manifest: string) {
  execFileSync("kubectl", ["--context", context, "apply", "-f", "-"], {
    env: process.env,
    input: manifest,
    stdio: ["pipe", "inherit", "inherit"]
  });
}
