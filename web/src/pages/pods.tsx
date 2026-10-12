import {
  FileCode2,
  Plug,
  PlugZap,
  RefreshCcw,
  ScrollText,
  TerminalSquare,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ActionMenu } from "../components/ui/action-menu";
import { Button } from "../components/ui/button";
import { PageHeader, PageShell } from "../components/ui/page";
import { QueryState } from "../components/ui/query-state";
import { SearchInput } from "../components/ui/search-input";
import {
  SortableHeader,
  type SortDirection,
} from "../components/ui/sortable-header";
import { StatusBadge } from "../components/ui/status-badge";
import { TablePagination } from "../components/ui/table-pagination";
import { TableTools } from "../components/ui/table-preferences";
import { useTablePreferences } from "../hooks/use-table-preferences";
import { useWatch } from "../hooks/use-watch";
import type { Pod, PodDetail, WatchFrame } from "../lib/api";
import { api } from "../lib/api";
import { tableKeyboardNavigation } from "../lib/table-preferences";
import { cn, formatAge } from "../lib/utils";
import { PodDrawer } from "./pod-detail/pod-drawer";

type SortKey = "name" | "namespace" | "status" | "restarts" | "age" | "node";

type PodsPageProps = {
  selectedNamespaces: string[];
};

const pageSize = 10;

export function PodsPage({ selectedNamespaces }: PodsPageProps) {
  const { clusterId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [pods, setPods] = useState<Pod[]>([]);
  const [selectedPod, setSelectedPod] = useState<Pod | null>(null);
  const [podDetail, setPodDetail] = useState<PodDetail | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("namespace");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [query, setQuery] = useState("");
  const table = useTablePreferences("pods", [
    { key: "name", label: "Name", width: 280 },
    { key: "namespace", label: "Namespace" },
    { key: "status", label: "Status" },
    { key: "ready", label: "Ready", width: 80 },
    { key: "restarts", label: "Restarts", width: 100 },
    { key: "age", label: "Age", width: 100 },
    { key: "node", label: "Node", width: 220 },
    { key: "actions", label: "Actions", width: 80 },
  ]);
  const selectedNamespaceKey = selectedNamespaces.join(",");

  useEffect(() => {
    const name = searchParams.get("name");
    const namespace = searchParams.get("namespace");
    if (!name || !namespace) return;
    let cancelled = false;
    api
      .resourceDetail(clusterId, "pods", namespace, name)
      .then((object) => {
        if (!cancelled) setSelectedPod(podRowFromObject(object));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, searchParams]);

  const loadPods = useCallback(async () => {
    if (!clusterId) return;
    setLoading(true);
    try {
      setPods(await api.pods(clusterId, selectedNamespaces));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pods");
    } finally {
      setLoading(false);
    }
  }, [clusterId, selectedNamespaces]);

  useEffect(() => {
    void loadPods();
    setPage(1);
  }, [loadPods, selectedNamespaceKey]);

  const watchStatus = useWatch({
    clusterId,
    gvr: {
      group: "",
      version: "v1",
      resource: "pods",
      kind: "Pod",
      namespaced: true,
    },
    namespaces: selectedNamespaces,
    errorMessage: "Pod watch failed",
    onReset: () => void loadPods(),
    onError: (message) => setError(message),
    onFrame: (frame: WatchFrame) => {
      if (!frame.object || frame.type === "BOOKMARK") return;
      const pod = podRowFromObject(frame.object);
      if (!pod) return;
      const key = podRowKey(pod);
      setPods((current) => {
        const index = current.findIndex((item) => podRowKey(item) === key);
        if (frame.type === "DELETED") {
          if (index < 0) return current;
          const next = current.slice();
          next.splice(index, 1);
          return next;
        }
        if (index < 0) return [...current, pod];
        if (samePodRow(current[index], pod)) return current;
        const next = current.slice();
        next[index] = pod;
        return next;
      });
    },
  });

  useEffect(() => {
    if (!clusterId || !selectedPod) {
      setPodDetail(null);
      return;
    }
    let cancelled = false;
    setPodDetail(null);
    setDetailError("");
    api
      .podDetail(clusterId, selectedPod.namespace, selectedPod.name)
      .then((detail) => {
        if (!cancelled) setPodDetail(detail);
      })
      .catch((err) => {
        if (!cancelled)
          setDetailError(
            err instanceof Error ? err.message : "Failed to load pod detail",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, selectedPod]);

  const sortedPods = useMemo(() => {
    return pods
      .filter((pod) =>
        `${pod.name} ${pod.namespace} ${pod.status} ${pod.node}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
      .sort((a, b) => {
        const aValue = a[sortKey];
        const bValue = b[sortKey];
        const result =
          typeof aValue === "number" && typeof bValue === "number"
            ? aValue - bValue
            : String(aValue).localeCompare(String(bValue));
        return sortDirection === "asc" ? result : -result;
      });
  }, [pods, query, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sortedPods.length / pageSize));
  const pagePods = sortedPods.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  function toggleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDirection("asc");
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Pods"
        description={
          selectedNamespaces.length === 0
            ? "All namespaces in the active cluster."
            : `Filtered to ${selectedNamespaces.join(", ")}.`
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => void loadPods()}
            disabled={loading}
          >
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {error ? (
        <QueryState error={error} onRetry={() => void loadPods()} />
      ) : null}
      <div className="text-xs uppercase text-muted-foreground">
        Watch: {watchStatus}
      </div>

      <SearchInput
        className="max-w-sm"
        aria-label="Filter pods"
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setPage(1);
        }}
        placeholder="Filter pods by name, namespace, status, or node"
      />
      <TableTools
        table={table}
        rows={sortedPods.map((p) => ({
          name: p.name,
          namespace: p.namespace,
          status: p.status,
          ready: p.ready,
          restarts: p.restarts,
          age: p.age,
          node: p.node,
        }))}
        filename="pods"
        current={{ query, sortKey, sortDirection }}
        onView={(v) => {
          setQuery(v.query);
          setSortKey(v.sortKey as SortKey);
          setSortDirection(v.sortDirection);
          setPage(1);
        }}
      />
      <section
        onKeyDown={tableKeyboardNavigation}
        className="overflow-x-auto rounded-lg border border-border bg-card"
      >
        <table className="k8s-table">
          <thead className="k8s-thead">
            <tr>
              <SortableHeader
                label="Name"
                sortKey="name"
                style={table.style("name", true)}
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Namespace"
                sortKey="namespace"
                style={table.style("namespace", true)}
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Status"
                sortKey="status"
                style={table.style("status", true)}
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <th className="k8s-th" style={table.style("ready", true)}>
                Ready
              </th>
              <SortableHeader
                label="Restarts"
                sortKey="restarts"
                style={table.style("restarts", true)}
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Age"
                sortKey="age"
                style={table.style("age", true)}
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Node"
                sortKey="node"
                style={table.style("node", true)}
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <th
                className="w-12 px-2 py-3"
                style={table.style("actions", true)}
                aria-label="Actions"
              />
            </tr>
          </thead>
          <tbody>
            {pagePods.map((pod) => {
              const podRoute = `/clusters/${clusterId}/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}`;
              return (
                <tr
                  key={`${pod.namespace}/${pod.name}`}
                  tabIndex={0}
                  className="table-row-hover k8s-row"
                  onClick={() => setSelectedPod(pod)}
                >
                  <td style={table.style("name")} className="k8s-td-name">
                    <button
                      className="text-left hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setSelectedPod(pod)}
                    >
                      {pod.name}
                    </button>
                  </td>
                  <td style={table.style("namespace")} className="k8s-td-muted">
                    {pod.namespace}
                  </td>
                  <td style={table.style("status")} className="k8s-td">
                    <StatusBadge status={pod.status} />
                  </td>
                  <td style={table.style("ready")} className="k8s-td-muted">
                    {pod.ready}
                  </td>
                  <td
                    style={table.style("restarts")}
                    className="k8s-td-numeric"
                  >
                    {pod.restarts}
                  </td>
                  <td style={table.style("age")} className="k8s-td-muted">
                    {pod.age}
                  </td>
                  <td
                    style={table.style("node")}
                    className="k8s-td-muted truncate"
                  >
                    {pod.node}
                  </td>
                  <td
                    style={table.style("actions")}
                    className="k8s-td-actions"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ActionMenu
                      label={`Actions for ${pod.name}`}
                      items={[
                        {
                          label: "View details",
                          icon: <FileCode2 className="h-3.5 w-3.5" />,
                          onClick: () => setSelectedPod(pod),
                        },
                        {
                          label: "Logs",
                          icon: <ScrollText className="h-3.5 w-3.5" />,
                          onClick: () => navigate(`${podRoute}/logs`),
                        },
                        {
                          label: "Exec",
                          icon: <TerminalSquare className="h-3.5 w-3.5" />,
                          onClick: () => navigate(`${podRoute}/exec`),
                        },
                        {
                          label: "Attach",
                          icon: <PlugZap className="h-3.5 w-3.5" />,
                          onClick: () => navigate(`${podRoute}/attach`),
                        },
                        {
                          label: "Port-forward",
                          icon: <Plug className="h-3.5 w-3.5" />,
                          onClick: () => navigate(`${podRoute}/port-forward`),
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
            {sortedPods.length === 0 ? (
              <tr>
                <td
                  className="bg-card px-4 py-8 text-center text-muted-foreground"
                  colSpan={8}
                >
                  {loading ? "Loading pods..." : "No pods found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <TablePagination
          total={sortedPods.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          className="border-t border-border"
        />
      </section>

      {selectedPod ? (
        <PodDrawer
          clusterId={clusterId}
          pod={selectedPod}
          detail={podDetail}
          error={detailError}
          onClose={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("name");
            next.delete("namespace");
            setSearchParams(next, { replace: true });
            setSelectedPod(null);
            setPodDetail(null);
            setDetailError("");
          }}
        />
      ) : null}
    </PageShell>
  );
}

function podRowKey(pod: Pod) {
  return `${pod.namespace}/${pod.name}`;
}

function samePodRow(a: Pod, b: Pod) {
  return (
    a.status === b.status &&
    a.ready === b.ready &&
    a.restarts === b.restarts &&
    a.age === b.age &&
    a.node === b.node &&
    a.ip === b.ip
  );
}

function podRowFromObject(object: Record<string, unknown>): Pod | null {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;
  const name = typeof meta.name === "string" ? meta.name : "";
  const namespace = typeof meta.namespace === "string" ? meta.namespace : "";
  if (!name || !namespace) return null;
  const spec =
    object.spec && typeof object.spec === "object"
      ? (object.spec as Record<string, unknown>)
      : {};
  const status =
    object.status && typeof object.status === "object"
      ? (object.status as Record<string, unknown>)
      : {};
  const containers = Array.isArray(spec.containers) ? spec.containers : [];
  const containerStatuses = Array.isArray(status.containerStatuses)
    ? status.containerStatuses
    : [];
  let ready = 0;
  let restarts = 0;
  for (const item of containerStatuses) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.ready === true) ready += 1;
    if (typeof row.restartCount === "number") restarts += row.restartCount;
  }
  return {
    name,
    namespace,
    status:
      typeof meta.deletionTimestamp === "string"
        ? "Terminating"
        : typeof status.phase === "string"
          ? status.phase
          : "",
    restarts,
    age:
      typeof meta.creationTimestamp === "string"
        ? formatAge(meta.creationTimestamp)
        : "",
    node: typeof spec.nodeName === "string" ? spec.nodeName : "",
    ready: `${ready}/${containers.length}`,
    ip: typeof status.podIP === "string" ? status.podIP : "",
  };
}
