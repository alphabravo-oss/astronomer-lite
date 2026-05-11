import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout/app-shell";
import type { Cluster } from "./lib/api";
import { api } from "./lib/api";
import { ClusterList } from "./pages/cluster-list";
import { PodLogsPage } from "./pages/pod-logs";
import { PodPortForwardPage } from "./pages/pod-port-forward";
import { resourcePlugins } from "./plugins/registry";

const emptyNamespaces: string[] = [];
const PodExecPage = lazy(() => import("./pages/pod-exec").then((module) => ({ default: module.PodExecPage })));

export function App() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [error, setError] = useState("");
  const [namespacesByCluster, setNamespacesByCluster] = useState<Record<string, string[]>>({});
  const previousClusterId = useRef("");
  const location = useLocation();
  const activeClusterId = location.pathname.match(/^\/clusters\/([^/]+)/)?.[1] ?? "";
  const selectedNamespaces = activeClusterId ? namespacesByCluster[activeClusterId] ?? emptyNamespaces : emptyNamespaces;

  async function refresh() {
    try {
      setClusters(await api.clusters());
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
        setNamespacesByCluster((current) => ({ ...current, [activeClusterId]: parsed.filter((item) => typeof item === "string") }));
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
      .then((sessions) => Promise.allSettled(sessions.map((session) => api.stopPortForward(previous, session.id))))
      .then((results) => {
        if (!cancelled && results.some((result) => result.status === "rejected")) {
          setError("Failed to stop one or more port-forwards from the previous cluster.");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to stop previous cluster port-forwards");
      });
    return () => {
      cancelled = true;
    };
  }, [activeClusterId]);

  function setSelectedNamespaces(namespaces: string[]) {
    if (!activeClusterId) return;
    localStorage.setItem(`namespaces:${activeClusterId}`, JSON.stringify(namespaces));
    setNamespacesByCluster((current) => ({ ...current, [activeClusterId]: namespaces }));
  }

  const plugins = resourcePlugins(clusters, selectedNamespaces);

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
              {error ? <div className="mb-4 rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
              <ClusterList clusters={clusters} onRefresh={refresh} />
            </>
          }
        />
        {plugins.map((plugin) => (
          <Route
            key={plugin.id}
            path={`clusters/:clusterId${plugin.route ? `/${plugin.route}` : ""}`}
            element={plugin.element}
          />
        ))}
        <Route
          path="clusters/:clusterId/pods/:namespace/:name/exec"
          element={
            <Suspense fallback={<div className="text-sm text-muted-foreground">Loading terminal...</div>}>
              <PodExecPage />
            </Suspense>
          }
        />
        <Route
          path="clusters/:clusterId/pods/:namespace/:name/attach"
          element={
            <Suspense fallback={<div className="text-sm text-muted-foreground">Loading terminal...</div>}>
              <PodExecPage />
            </Suspense>
          }
        />
        <Route path="clusters/:clusterId/pods/:namespace/:name/logs" element={<PodLogsPage />} />
        <Route path="clusters/:clusterId/pods/:namespace/:name/port-forward" element={<PodPortForwardPage />} />
        <Route path="clusters/:clusterId/services/:namespace/:name/port-forward" element={<PodPortForwardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
