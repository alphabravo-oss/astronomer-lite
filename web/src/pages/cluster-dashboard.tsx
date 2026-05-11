import { AlertTriangle, Box, Layers, Server, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { MetricCard } from "../components/ui/metric-card";
import { StatusBadge } from "../components/ui/status-badge";
import type { Cluster, Dashboard } from "../lib/api";
import { api } from "../lib/api";

export function ClusterDashboard({ clusters }: { clusters: Cluster[] }) {
  const { clusterId = "" } = useParams();
  const cluster = clusters.find((item) => item.id === clusterId);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clusterId) return;
    let cancelled = false;
    setError("");
    api
      .dashboard(clusterId)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load dashboard");
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId]);

  const stats = useMemo(
    () => [
      { label: "Nodes", value: dashboard?.nodeCount ?? "-", icon: Server, subtitle: "schedulable capacity" },
      { label: "Pods", value: dashboard?.podCount ?? "-", icon: Box, subtitle: "all namespaces" },
      { label: "Namespaces", value: dashboard?.namespaceCount ?? "-", icon: Layers, subtitle: "cluster scopes" },
      { label: "Version", value: dashboard?.serverVersion || cluster?.version || "-", icon: Tag, subtitle: "api server" }
    ],
    [cluster?.version, dashboard]
  );

  if (!cluster) {
    return <div className="text-sm text-muted-foreground">Cluster not found.</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <StatusBadge status={cluster.status ?? (cluster.reachable ? "reachable" : "unreachable")} />
            <Badge tone="muted">{cluster.source === "managed" ? "app-managed" : "managed externally"}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{cluster.name}</h1>
          <p className="mt-1 max-w-3xl truncate text-sm text-muted-foreground">{cluster.server}</p>
        </div>
        <Link
          to={`/clusters/${cluster.id}/pods`}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          View pods
        </Link>
      </div>

      {cluster.error || error ? (
        <div className="flex gap-3 rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{cluster.error || error}</div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <MetricCard key={stat.label} title={stat.label} value={stat.value} subtitle={stat.subtitle} icon={<Icon className="h-4 w-4" />} />
          );
        })}
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">Node conditions</h2>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-4">
          {dashboard?.conditions && Object.keys(dashboard.conditions).length > 0 ? (
            Object.entries(dashboard.conditions).map(([condition, count]) => (
              <StatusBadge key={condition} status={condition === "Ready" ? "reachable" : "degraded"} label={`${condition}: ${count}`} pulse={false} />
            ))
          ) : (
            <span className="text-sm text-muted-foreground">No condition data loaded.</span>
          )}
        </div>
      </section>
    </div>
  );
}
