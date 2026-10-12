import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { dump } from "js-yaml";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  api,
  type Cluster,
  type TopologyGraph,
  type TopologyNode,
} from "../lib/api";
import { projects, type Project, type ProjectScope } from "../lib/projects";
import { resourceLink } from "../lib/resource-link";
import { PageHeader, PageShell, PageSection } from "../components/ui/page";
import { QueryState } from "../components/ui/query-state";
import { Button } from "../components/ui/button";
import { DataTable, type Column } from "../components/ui/data-table";
import { ConfirmDialog } from "../components/ui/confirm-dialog";

type ScopeResult = {
  scope: ProjectScope;
  graph?: TopologyGraph;
  error?: string;
  access?: string;
};
type Row = TopologyNode & {
  key: string;
  clusterId: string;
  clusterName: string;
};
const resources: Record<string, string> = {
  Pod: "pods",
  Service: "services",
  Deployment: "deployments",
  ReplicaSet: "replicasets",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  Job: "jobs",
  CronJob: "cronjobs",
  Ingress: "ingresses",
  ConfigMap: "configmaps",
  Secret: "secrets",
  PersistentVolumeClaim: "persistentvolumeclaims",
  ServiceAccount: "serviceaccounts",
  HorizontalPodAutoscaler: "horizontalpodautoscalers",
};
function objectLink(row: Row) {
  return resourceLink(row.clusterId, {
    resource: resources[row.kind] ?? row.kind.toLowerCase(),
    name: row.name,
    namespace: row.namespace,
  });
}
export function ProjectDetailPage({ clusters }: { clusters: Cluster[] }) {
  const { projectId = "" } = useParams();
  return (
    <ProjectDetail key={projectId} projectId={projectId} clusters={clusters} />
  );
}
function ProjectDetail({
  projectId,
  clusters,
}: {
  projectId: string;
  clusters: Cluster[];
}) {
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [results, setResults] = useState<ScopeResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function refresh() {
      try {
        const item = await projects.get(projectId);
        if (!active) return;
        setProject(item);
        const collected: ScopeResult[] = [];
        // Bound cluster fan-out for projects spanning many namespaces.
        for (let start = 0; start < item.scopes.length && active; start += 4) {
          const batch = await Promise.all(
            item.scopes
              .slice(start, start + 4)
              .map(async (scope): Promise<ScopeResult> => {
                const [graph, permission] = await Promise.allSettled([
                  api.topology(scope.clusterId, scope.namespace),
                  api.canI(scope.clusterId, {
                    verb: "list",
                    group: "",
                    resource: "pods",
                    namespace: scope.namespace,
                  }),
                ]);
                return {
                  scope,
                  ...(graph.status === "fulfilled"
                    ? { graph: graph.value }
                    : { error: String(graph.reason) }),
                  access:
                    permission.status === "fulfilled"
                      ? permission.value.allowed
                        ? "Pod listing allowed"
                        : "Pod listing denied"
                      : "Permission check unavailable",
                };
              }),
          );
          collected.push(...batch);
        }
        if (active) setResults(collected);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    return () => {
      active = false;
    };
  }, [projectId, refreshKey]);
  const rows = useMemo<Row[]>(
    () =>
      results.flatMap(({ scope, graph }) =>
        (graph?.nodes ?? []).map((node) => ({
          ...node,
          key: scope.clusterId + "/" + node.id,
          clusterId: scope.clusterId,
          clusterName:
            clusters.find((c) => c.id === scope.clusterId)?.name ??
            "Unavailable cluster",
        })),
      ),
    [results, clusters],
  );
  const warnings = results.flatMap((r) =>
    [...(r.error ? [r.error] : []), ...(r.graph?.warnings ?? [])].map(
      (message) =>
        `${clusters.find((c) => c.id === r.scope.clusterId)?.name ?? "Unavailable cluster"}/${r.scope.namespace}: ${message}`,
    ),
  );
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      accessor: (r) => (
        <Link className="underline" to={objectLink(r)}>
          {r.name}
        </Link>
      ),
      textAccessor: (r) => r.name,
    },
    { key: "kind", header: "Kind", accessor: (r) => r.kind },
    { key: "cluster", header: "Cluster", accessor: (r) => r.clusterName },
    { key: "namespace", header: "Namespace", accessor: (r) => r.namespace },
    { key: "status", header: "Status", accessor: (r) => r.status || "—" },
  ];
  const graph = useMemo(() => {
    const shown = rows.slice(0, 500);
    const kinds = [...new Set(shown.map((r) => r.kind))];
    const counts: Record<string, number> = {};
    const nodes: Node[] = shown.map((row) => {
      const index = counts[row.kind] ?? 0;
      counts[row.kind] = index + 1;
      return {
        id: row.key,
        position: { x: kinds.indexOf(row.kind) * 300, y: index * 100 },
        data: {
          label: (
            <div className="text-left text-xs">
              <p className="text-muted-foreground">
                {row.clusterName} · {row.namespace} · {row.kind}
              </p>
              <Link
                className="nodrag nowheel mt-1 block truncate font-medium underline"
                to={objectLink(row)}
              >
                {row.name}
              </Link>
            </div>
          ),
        },
        style: {
          width: 260,
          background: "hsl(var(--card))",
          color: "hsl(var(--foreground))",
          borderColor: "hsl(var(--border))",
        },
      };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = results
      .flatMap(({ scope, graph }) =>
        (graph?.edges ?? []).map((edge, i) => ({
          id: scope.clusterId + "/" + scope.namespace + "/" + i,
          source: scope.clusterId + "/" + edge.from,
          target: scope.clusterId + "/" + edge.to,
          label: edge.kind,
          markerEnd: { type: MarkerType.ArrowClosed },
        })),
      )
      .filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges };
  }, [rows, results]);
  async function remove() {
    setDeleting(true);
    try {
      await projects.remove(projectId);
      navigate("/projects");
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  }
  function exportProject() {
    if (!project) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          dump({
            name: project.name,
            description: project.description,
            scopes: project.scopes,
          }),
        ],
        { type: "application/yaml" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "project.yaml";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <PageShell>
      <PageHeader
        title={project?.name ?? "Project"}
        description={project?.description}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => setRefreshKey((n) => n + 1)}
            >
              Refresh
            </Button>
            <Link
              className="text-sm underline"
              to={`/projects/${projectId}/edit`}
            >
              Edit project
            </Link>
            <Button variant="ghost" onClick={exportProject}>
              Export YAML
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete project
            </Button>
          </>
        }
      />
      <nav aria-label="Project views" className="flex flex-wrap gap-2">
        {["Overview", "Resources", "Map", "Access"].map((name) => (
          <Button
            key={name}
            aria-current={tab === name ? "page" : undefined}
            variant={tab === name ? "default" : "secondary"}
            onClick={() => setTab(name)}
          >
            {name}
          </Button>
        ))}
      </nav>
      <QueryState
        loading={loading}
        error={error}
        onRetry={() => setRefreshKey((n) => n + 1)}
      >
        {warnings.length > 0 && (
          <div
            role="status"
            className="space-y-2 rounded-lg border border-status-warning/30 bg-status-warning/10 p-4 text-sm"
          >
            <p className="font-semibold">
              Partial results — some resources could not be read.
            </p>
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}
        {tab === "Overview" && (
          <PageSection title="Project overview">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                [
                  "Clusters",
                  new Set(project?.scopes.map((s) => s.clusterId)).size,
                ],
                ["Namespaces", project?.scopes.length ?? 0],
                ["Graph resources", rows.length],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-border bg-card p-[var(--card-p)]"
                >
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Inventory includes workloads, services, and referenced resources
              visible to your credentials. Project membership grants no
              additional permissions.
            </p>
            <ul className="space-y-2">
              {project?.scopes.map((s) => (
                <li key={s.clusterId + s.namespace}>
                  <Link
                    className="text-sm underline"
                    to={resourceLink(s.clusterId, {
                      resource: "namespaces",
                      name: s.namespace,
                    })}
                  >
                    {clusters.find((c) => c.id === s.clusterId)?.name ??
                      "Unavailable cluster"}{" "}
                    / {s.namespace}
                  </Link>
                </li>
              ))}
            </ul>
          </PageSection>
        )}
        {tab === "Resources" && (
          <DataTable
            data={rows}
            columns={columns}
            keyExtractor={(r) => r.key}
            searchPlaceholder="Search project resources"
            emptyMessage="No graph resources are visible in these namespaces."
          />
        )}
        {tab === "Map" && (
          <>
            <p className="text-sm text-muted-foreground">
              Dependencies across project scopes.{" "}
              {rows.length > 500
                ? "Showing the first 500 resources; use Resources to search the complete returned inventory."
                : "Select a resource name to open its details."}
            </p>
            <div className="h-[32rem] rounded-lg border border-border bg-card">
              <ReactFlow
                key={refreshKey}
                nodes={graph.nodes}
                edges={graph.edges}
                fitView
                minZoom={0.05}
                nodesDraggable={false}
              >
                <Background />
                <Controls />
              </ReactFlow>
            </div>
          </>
        )}
        {tab === "Access" && (
          <PageSection
            title="Cluster access"
            description="These checks use your Kubernetes credentials. Project settings do not change RBAC."
          >
            <ul className="space-y-2">
              {results.map((r) => (
                <li
                  className="rounded border border-border p-3 text-sm"
                  key={r.scope.clusterId + r.scope.namespace}
                >
                  {clusters.find((c) => c.id === r.scope.clusterId)?.name ??
                    "Unavailable cluster"}{" "}
                  / {r.scope.namespace}: {r.access}
                </li>
              ))}
            </ul>
          </PageSection>
        )}
      </QueryState>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        loading={deleting}
        title="Delete project"
        description="Remove this project from your workspace. Its Kubernetes resources will remain in their clusters."
        confirmText="Delete project"
      />
    </PageShell>
  );
}
