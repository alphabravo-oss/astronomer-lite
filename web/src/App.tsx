import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout/app-shell";
import type { Cluster } from "./lib/api";
import { api } from "./lib/api";
import { ClusterList } from "./pages/cluster-list";
import { PodLogsPage } from "./pages/pod-logs";
import { PodPortForwardPage } from "./pages/pod-port-forward";
import { resourcePages } from "./navigation/registry";
import { SettingsPage } from "./pages/settings";
import { HelmDeployPage } from "./pages/helm-deploy";
import { ProjectsPage, ProjectFormPage } from "./pages/projects";
import { ProjectDetailPage } from "./pages/project-detail";
import { ClusterConnectPage } from "./pages/cluster-connect";

import { useAuth } from "./lib/auth-context";

const emptyNamespaces: string[] = [];
const ExtensionPage = lazy(() =>
  import("./pages/extension").then((module) => ({
    default: module.ExtensionPage,
  })),
);
const PodExecPage = lazy(() =>
  import("./pages/pod-exec").then((module) => ({
    default: module.PodExecPage,
  })),
);

function sameClusters(a: Cluster[], b: Cluster[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.status !== y.status ||
      x.reachable !== y.reachable ||
      x.version !== y.version ||
      x.error !== y.error ||
      x.displayColor !== y.displayColor ||
      x.displayInitials !== y.displayInitials
    ) {
      return false;
    }
  }
  return true;
}

export function App() {
  const { plugins: pluginsEnabled } = useAuth();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [error, setError] = useState("");
  const [namespacesByCluster, setNamespacesByCluster] = useState<
    Record<string, string[]>
  >({});
  const previousClusterId = useRef("");
  const location = useLocation();
  const routeClusterId =
    location.pathname.match(/^\/clusters\/([^/]+)/)?.[1] ?? "";
  const activeClusterId = routeClusterId === "connect" ? "" : routeClusterId;
  const selectedNamespaces = activeClusterId
    ? (namespacesByCluster[activeClusterId] ?? emptyNamespaces)
    : emptyNamespaces;

  async function refresh() {
    try {
      const next = await api.clusters();
      setClusters((prev) => (sameClusters(prev, next) ? prev : next));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clusters");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeClusterId || namespacesByCluster[activeClusterId]) return;
    const stored = localStorage.getItem(`namespaces:${activeClusterId}`);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setNamespacesByCluster((current) => ({
          ...current,
          [activeClusterId]: parsed.filter((item) => typeof item === "string"),
        }));
      }
    } catch {
      localStorage.removeItem(`namespaces:${activeClusterId}`);
    }
  }, [activeClusterId, namespacesByCluster]);

  useEffect(() => {
    const previous = previousClusterId.current;
    previousClusterId.current = activeClusterId;
    if (!previous || previous === activeClusterId) return;

    let cancelled = false;
    api
      .portForwards(previous)
      .then((sessions) =>
        Promise.allSettled(
          sessions.map((session) => api.stopPortForward(previous, session.id)),
        ),
      )
      .then((results) => {
        if (
          !cancelled &&
          results.some((result) => result.status === "rejected")
        ) {
          setError(
            "Failed to stop one or more port-forwards from the previous cluster.",
          );
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : "Failed to stop previous cluster port-forwards",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [activeClusterId]);

  function setSelectedNamespaces(namespaces: string[]) {
    if (!activeClusterId) return;
    localStorage.setItem(
      `namespaces:${activeClusterId}`,
      JSON.stringify(namespaces),
    );
    setNamespacesByCluster((current) => ({
      ...current,
      [activeClusterId]: namespaces,
    }));
  }

  const pages = resourcePages(clusters, selectedNamespaces);

  return (
    <Routes>
      <Route
        element={
          <AppShell
            clusters={clusters}
            onRefresh={refresh}
            selectedNamespaces={selectedNamespaces}
            onSelectedNamespacesChange={setSelectedNamespaces}
          />
        }
      >
        <Route
          index
          element={
            <>
              {error ? (
                <div className="mb-4 rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
              <ClusterList clusters={clusters} onRefresh={refresh} />
            </>
          }
        />
        {pages.map((page) => (
          <Route
            key={page.id}
            path={`clusters/:clusterId${page.route ? `/${page.route}` : ""}`}
            element={page.element}
          />
        ))}
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="clusters/connect"
          element={<ClusterConnectPage onRefresh={refresh} />}
        />
        <Route path="projects" element={<ProjectsPage />} />
        <Route
          path="projects/new"
          element={<ProjectFormPage clusters={clusters} />}
        />
        <Route
          path="projects/:projectId"
          element={<ProjectDetailPage clusters={clusters} />}
        />
        <Route
          path="projects/:projectId/edit"
          element={<ProjectFormPage clusters={clusters} />}
        />
        <Route
          path="clusters/:clusterId/helm/install"
          element={<HelmDeployPage />}
        />
        <Route
          path="clusters/:clusterId/helm/releases/:namespace/:name/upgrade"
          element={<HelmDeployPage />}
        />
        {pluginsEnabled && (
          <Route
            path="clusters/:clusterId/extensions/:extensionId"
            element={
              <Suspense fallback={<p role="status">Loading plugin…</p>}>
                <ExtensionPage selectedNamespaces={selectedNamespaces} />
              </Suspense>
            }
          />
        )}
        <Route
          path="clusters/:clusterId/pods/:namespace/:name/exec"
          element={
            <Suspense
              fallback={
                <div className="text-sm text-muted-foreground">
                  Loading terminal...
                </div>
              }
            >
              <PodExecPage />
            </Suspense>
          }
        />
        <Route
          path="clusters/:clusterId/pods/:namespace/:name/attach"
          element={
            <Suspense
              fallback={
                <div className="text-sm text-muted-foreground">
                  Loading terminal...
                </div>
              }
            >
              <PodExecPage />
            </Suspense>
          }
        />
        <Route
          path="clusters/:clusterId/pods/:namespace/:name/logs"
          element={<PodLogsPage />}
        />
        <Route
          path="clusters/:clusterId/pods/:namespace/:name/port-forward"
          element={<PodPortForwardPage />}
        />
        <Route
          path="clusters/:clusterId/services/:namespace/:name/port-forward"
          element={<PodPortForwardPage />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
