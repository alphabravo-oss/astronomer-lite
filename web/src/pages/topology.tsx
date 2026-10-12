import { QueryState } from "../components/ui/query-state";
import { PageHeader, PageShell } from "../components/ui/page";
import { Select } from "../components/ui/input";
import { RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { api } from "../lib/api";
import type {
  Namespace,
  TopologyEdge,
  TopologyGraph,
  TopologyNode,
} from "../lib/api";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { resourceLink } from "../lib/resource-link";

const KIND_ORDER = [
  "Ingress",
  "CronJob",
  "Job",
  "HorizontalPodAutoscaler",
  "Service",
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Pod",
  "ConfigMap",
  "Secret",
  "PersistentVolumeClaim",
  "ServiceAccount",
] as const;

const KIND_COLORS: Record<string, string> = {
  Service:
    "bg-indigo-500/10 border-indigo-500/40 text-indigo-800 dark:text-indigo-200",
  Deployment:
    "bg-blue-500/10 border-blue-500/40 text-blue-800 dark:text-blue-200",
  StatefulSet:
    "bg-violet-500/10 border-violet-500/40 text-violet-800 dark:text-violet-200",
  DaemonSet:
    "bg-cyan-500/10 border-cyan-500/40 text-cyan-800 dark:text-cyan-200",
  ReplicaSet: "bg-sky-500/10 border-sky-500/40 text-sky-800 dark:text-sky-200",
  Pod: "bg-emerald-500/10 border-emerald-500/40 text-emerald-800 dark:text-emerald-200",
  ConfigMap:
    "bg-amber-500/10 border-amber-500/40 text-amber-800 dark:text-amber-200",
  Secret: "bg-rose-500/10 border-rose-500/40 text-rose-800 dark:text-rose-200",
  PersistentVolumeClaim:
    "bg-fuchsia-500/10 border-fuchsia-500/40 text-fuchsia-800 dark:text-fuchsia-200",
};

const KIND_RESOURCES: Record<string, string> = {
  Job: "jobs",
  CronJob: "cronjobs",
  Ingress: "ingresses",
  HorizontalPodAutoscaler: "horizontalpodautoscalers",
  ServiceAccount: "serviceaccounts",
  Service: "services",
  Deployment: "deployments",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  ReplicaSet: "replicasets",
  Pod: "pods",
  ConfigMap: "configmaps",
  Secret: "secrets",
  PersistentVolumeClaim: "persistentvolumeclaims",
};

function statusDot(status?: string) {
  if (status === "healthy") return "bg-status-success";
  if (status === "degraded") return "bg-status-warning";
  if (status === "failing") return "bg-status-error";
  return "bg-muted-foreground/40";
}

function layout(
  graph: TopologyGraph,
  clusterId: string,
): { nodes: Node[]; edges: Edge[] } {
  const swimlanes: Record<string, TopologyNode[]> = {};
  for (const node of graph.nodes) {
    if (!swimlanes[node.kind]) swimlanes[node.kind] = [];
    swimlanes[node.kind].push(node);
  }
  const kindOrder = [
    ...KIND_ORDER,
    ...Object.keys(swimlanes).filter(
      (k) => !KIND_ORDER.includes(k as (typeof KIND_ORDER)[number]),
    ),
  ];
  const nodes: Node[] = [];
  const laneWidth = 220;
  const rowHeight = 78;
  let laneX = 0;
  for (const kind of kindOrder) {
    const lane = swimlanes[kind];
    if (!lane) continue;
    lane.sort((a, b) => a.name.localeCompare(b.name));
    lane.forEach((node, index) => {
      nodes.push({
        id: node.id,
        position: { x: laneX, y: index * rowHeight },
        data: {
          label: (
            <div
              className={cn(
                "w-[200px] rounded-md border px-3 py-2",
                KIND_COLORS[kind] ?? "bg-muted text-foreground",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn("h-2 w-2 rounded-full", statusDot(node.status))}
                  aria-hidden
                />
                <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {kind}
                </span>
              </div>
              {KIND_RESOURCES[kind] ? (
                <Link
                  className="nodrag nowheel mt-1 block truncate font-mono text-xs hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  to={resourceLink(clusterId, {
                    ...node,
                    resource: KIND_RESOURCES[kind],
                  })}
                >
                  {node.name}
                </Link>
              ) : (
                <p className="mt-1 truncate font-mono text-xs">{node.name}</p>
              )}
            </div>
          ),
        },
        // Hide the default reactflow box so our pill is the visual.
        type: "default",
        style: { background: "transparent", border: "none", padding: 0 },
      });
    });
    laneX += laneWidth;
  }
  const edgeStyle: Record<
    TopologyEdge["kind"],
    { style: React.CSSProperties; label: string }
  > = {
    owns: {
      style: { stroke: "hsl(var(--status-info))", strokeWidth: 1.5 },
      label: "",
    },
    selects: {
      style: {
        stroke: "hsl(var(--status-pending))",
        strokeWidth: 1.5,
        strokeDasharray: "5 4",
      },
      label: "",
    },
    mounts: {
      style: {
        stroke: "hsl(var(--status-warning))",
        strokeWidth: 1.5,
        strokeDasharray: "2 4",
      },
      label: "",
    },
    uses: {
      style: {
        stroke: "hsl(var(--status-neutral))",
        strokeWidth: 1.5,
        strokeDasharray: "2 4",
      },
      label: "uses",
    },
    routes: {
      style: { stroke: "hsl(var(--status-info))", strokeWidth: 1.5 },
      label: "routes",
    },
    scales: {
      style: { stroke: "hsl(var(--status-success))", strokeWidth: 1.5 },
      label: "scales",
    },
  };
  const edges: Edge[] = graph.edges.map((edge, index) => ({
    id: `${edge.kind}-${index}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: "default",
    label: edgeStyle[edge.kind].label,
    animated: edge.kind === "selects",
    style: edgeStyle[edge.kind].style,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edgeStyle[edge.kind].style.stroke as string | undefined,
    },
  }));
  return { nodes, edges };
}

function TopologyCanvas({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const { fitView } = useReactFlow();
  const nodeKey = useMemo(
    () =>
      nodes
        .map((node) => node.id)
        .sort()
        .join("|"),
    [nodes],
  );

  // Refit whenever the set of nodes changes (e.g. namespace switch, refresh).
  useEffect(() => {
    if (nodes.length === 0) return;
    const id = window.setTimeout(
      () => fitView({ padding: 0.15, duration: 250 }),
      0,
    );
    return () => window.clearTimeout(id);
  }, [fitView, nodeKey, nodes.length]);

  // Refit on container resize so the graph stays framed when the viewport shrinks/grows.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      fitView({ padding: 0.15, duration: 0 }),
    );
    const target = document.querySelector(".topology-canvas");
    if (target) observer.observe(target);
    return () => observer.disconnect();
  }, [fitView]);

  return (
    <div className="topology-canvas h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        minZoom={0.1}
      >
        <Background gap={24} size={1} color="rgba(148, 163, 184, 0.18)" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function TopologyPage() {
  const { clusterId = "" } = useParams();
  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [namespace, setNamespace] = useState<string>("default");
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [namespacesError, setNamespacesError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!clusterId) return;
    let cancelled = false;
    api
      .namespaces(clusterId)
      .then((rows) => {
        if (cancelled) return;
        setNamespaces(rows);
        setNamespacesError("");
        setNamespace((current) => {
          if (rows.some((row) => row.name === current)) return current;
          if (rows.some((row) => row.name === "default")) return "default";
          return rows[0]?.name ?? current;
        });
      })
      .catch((err) => {
        if (!cancelled)
          setNamespacesError(
            err instanceof Error ? err.message : "Failed to load namespaces",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId]);

  useEffect(() => {
    if (!clusterId || !namespace) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .topology(clusterId, namespace)
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load topology",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, namespace, tick]);

  const flow = useMemo(
    () => (graph ? layout(graph, clusterId) : { nodes: [], edges: [] }),
    [graph, clusterId],
  );

  return (
    <PageShell className="flex min-h-[32rem] h-[calc(100dvh-7rem)] flex-col">
      <PageHeader
        title="Topology"
        description="Resource graph for the selected namespace."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="topology-namespace"
            >
              Namespace
            </label>
            <Select
              id="topology-namespace"
              value={namespace}
              onChange={(event) => setNamespace(event.target.value)}
              disabled={namespaces.length === 0}
              className="w-40 sm:w-56 font-mono"
            >
              {namespaces.length === 0 && !namespacesError ? (
                <option value={namespace}>Loading…</option>
              ) : null}
              {namespaces.length === 0 && namespacesError ? (
                <option value={namespace}>{namespace}</option>
              ) : null}
              {namespaces.map((row) => (
                <option key={row.name} value={row.name}>
                  {row.name}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTick((t) => t + 1)}
              disabled={loading}
            >
              <RefreshCcw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        }
      />
      {error ? <QueryState error={error} /> : null}
      {!!graph?.warnings?.length && (
        <details className="rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-sm">
          <summary>Partial topology — some resources could not be read</summary>
          {graph.warnings.map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
        </details>
      )}
      {namespacesError && !error ? (
        <div className="rounded-md border border-status-warning/35 bg-status-warning/10 p-3 text-xs text-status-warning">
          Namespace list unavailable: {namespacesError}
        </div>
      ) : null}
      <div className="flex-1 overflow-hidden rounded-lg border border-border bg-background">
        {graph && graph.nodes.length > 0 ? (
          <ReactFlowProvider>
            <TopologyCanvas nodes={flow.nodes} edges={flow.edges} />
          </ReactFlowProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {loading
              ? "Building topology..."
              : "No resources in this namespace."}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-status-info" /> owns
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-0.5 w-4 bg-status-pending"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg,hsl(var(--status-pending)) 0 4px, transparent 4px 8px)",
            }}
          />{" "}
          selects
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-0.5 w-4 bg-status-warning"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg,hsl(var(--status-warning)) 0 2px, transparent 2px 6px)",
            }}
          />{" "}
          mounts
        </span>
        {graph ? (
          <span>
            {graph.nodes.length} nodes · {graph.edges.length} edges
          </span>
        ) : null}
      </div>
    </PageShell>
  );
}
