import { Cpu, HardDrive, RefreshCcw, Server, Shapes } from "lucide-react";
import { lazy, Suspense } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DataTable, type Column } from "../components/ui/data-table";
import { MetricCard } from "../components/ui/metric-card";
import type { ClusterMetrics, MetricsRow } from "../lib/api";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

const MetricChart = lazy(() => import("../components/metrics/metric-chart").then((module) => ({ default: module.MetricChart })));

export function MetricsPage() {
  const { clusterId = "" } = useParams();
  const [metrics, setMetrics] = useState<ClusterMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadMetrics = useCallback(async () => {
    if (!clusterId) return;
    setLoading(true);
    try {
      const data = await api.metrics(clusterId);
      setMetrics(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, [clusterId]);

  useEffect(() => {
    void loadMetrics();
    const timer = window.setInterval(() => void loadMetrics(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadMetrics]);

  const topPods = useMemo(() => [...(metrics?.pods ?? [])].sort((a, b) => b.cpu - a.cpu).slice(0, 15), [metrics?.pods]);
  const topNodes = useMemo(() => [...(metrics?.nodes ?? [])].sort((a, b) => b.cpu - a.cpu), [metrics?.nodes]);
  const podChartRows = useMemo(() => topPods.slice(0, 10).map(metricChartRow), [topPods]);
  const nodeChartRows = useMemo(() => topNodes.map(metricChartRow), [topNodes]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone={metrics?.available ? "success" : "warning"}>{metrics?.available ? "metrics-server" : "optional"}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Metrics</h1>
          <p className="mt-1 text-sm text-muted-foreground">CPU and memory from the Kubernetes metrics API.</p>
        </div>
        <Button variant="secondary" onClick={() => void loadMetrics()} disabled={loading}>
          <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}

      {metrics && !metrics.available ? (
        <div className="rounded-lg border border-status-warning/35 bg-status-warning/10 p-4 text-sm text-status-warning">
          metrics-server is not available for this cluster. Install or enable the Kubernetes metrics API to populate this page.
          {metrics.error ? <div className="mt-2 font-mono text-xs opacity-80">{metrics.error}</div> : null}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Cluster CPU" value={formatCPU(metrics?.totalCPU ?? 0)} subtitle="current usage" percentage={metrics?.cpuPercent} icon={<Cpu className="h-4 w-4" />} />
        <MetricCard title="Cluster Memory" value={formatBytes(metrics?.totalMemory ?? 0)} subtitle="current usage" percentage={metrics?.memoryPercent} icon={<HardDrive className="h-4 w-4" />} />
        <MetricCard title="Nodes" value={metrics?.nodeCount ?? "-"} subtitle="reporting metrics" icon={<Server className="h-4 w-4" />} />
        <MetricCard title="Pods" value={metrics?.podCount ?? "-"} subtitle="reporting metrics" icon={<Shapes className="h-4 w-4" />} />
      </div>

      {metrics?.available ? (
        <Suspense fallback={<div className="shimmer h-72 rounded-lg bg-muted" />}>
          <div className="grid gap-4 xl:grid-cols-2">
            <MetricChart title="Node CPU" rows={nodeChartRows} dataKey="cpu" unit="m" empty={loading ? "Loading node metrics..." : "No node metrics found."} />
            <MetricChart title="Node Memory" rows={nodeChartRows} dataKey="memory" unit="bytes" empty={loading ? "Loading node metrics..." : "No node metrics found."} />
            <MetricChart title="Top Pod CPU" rows={podChartRows} dataKey="cpu" unit="m" empty={loading ? "Loading pod metrics..." : "No pod metrics found."} />
            <MetricChart title="Top Pod Memory" rows={podChartRows} dataKey="memory" unit="bytes" empty={loading ? "Loading pod metrics..." : "No pod metrics found."} />
          </div>
        </Suspense>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Node usage</h2>
        </div>
        <MetricsTable rows={topNodes} empty={loading ? "Loading node metrics..." : "No node metrics found."} showPercent />
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Top pods by CPU</h2>
        </div>
        <MetricsTable rows={topPods} empty={loading ? "Loading pod metrics..." : "No pod metrics found."} />
      </section>
    </div>
  );
}

type MetricChartRow = {
  label: string;
  fullName: string;
  cpu: number;
  memory: number;
};

function MetricsTable({ rows, empty, showPercent = false }: { rows: MetricsRow[]; empty: string; showPercent?: boolean }) {
  const columns: Column<MetricsRow>[] = [
    {
      key: "name",
      header: "Name",
      accessor: (row) => <span className="font-mono text-xs font-medium">{row.name}</span>,
      sortAccessor: (row) => row.name
    },
    {
      key: "namespace",
      header: "Namespace",
      accessor: (row) => <span className="font-mono text-xs text-muted-foreground">{row.namespace || "-"}</span>,
      sortAccessor: (row) => row.namespace || ""
    },
    {
      key: "cpu",
      header: "CPU",
      accessor: (row) => <span className="tabular-nums">{formatCPU(row.cpu)}</span>,
      sortAccessor: (row) => row.cpu
    },
    {
      key: "memory",
      header: "Memory",
      accessor: (row) => <span className="tabular-nums">{formatBytes(row.memory)}</span>,
      sortAccessor: (row) => row.memory
    },
    ...(showPercent
      ? [
          {
            key: "utilization",
            header: "Utilization",
            accessor: (row: MetricsRow) => {
              const value = Math.max(row.cpuPercent ?? 0, row.memoryPercent ?? 0);
              return (
                <div className="flex min-w-36 items-center gap-2">
                  <div className="gauge-bar flex-1">
                    <div className={cn("gauge-bar-fill", gaugeBarColor(value))} style={{ width: `${Math.min(100, value)}%` }} />
                  </div>
                  <span className="w-14 text-right text-xs text-muted-foreground">{(row.cpuPercent ?? 0).toFixed(1)}%</span>
                </div>
              );
            },
            sortAccessor: (row: MetricsRow) => Math.max(row.cpuPercent ?? 0, row.memoryPercent ?? 0)
          }
        ]
      : []),
    {
      key: "window",
      header: "Window",
      accessor: (row) => <span className="text-muted-foreground">{row.window || "-"}</span>,
      sortAccessor: (row) => row.window || ""
    }
  ];

  return (
    <div className="p-4">
      <DataTable data={rows} columns={columns} keyExtractor={(row) => `${row.namespace ?? "_cluster"}/${row.name}`} searchable={false} pageSize={10} emptyMessage={empty} />
    </div>
  );
}

function formatCPU(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} cores`;
  return `${value}m`;
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${value} B`;
}

function gaugeBarColor(percentage: number) {
  if (percentage >= 90) return "bg-status-error";
  if (percentage >= 75) return "bg-status-warning";
  return "bg-status-success";
}

function metricChartRow(row: MetricsRow): MetricChartRow {
  return {
    label: truncateMiddle(row.name, 18),
    fullName: row.namespace ? `${row.namespace}/${row.name}` : row.name,
    cpu: row.cpu,
    memory: row.memory
  };
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const head = Math.max(4, Math.floor((maxLength - 1) / 2));
  const tail = Math.max(4, maxLength - head - 1);
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}
