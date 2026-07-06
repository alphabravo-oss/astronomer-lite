import { ChevronLeft, ChevronRight, FileCode2, Plug, PlugZap, RefreshCcw, ScrollText, Star, TerminalSquare, X } from "lucide-react";
import { dump } from "js-yaml";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MetricSummary } from "../components/metrics/metric-summary";
import { ActionMenu } from "../components/ui/action-menu";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { SortableHeader, type SortDirection } from "../components/ui/sortable-header";
import { StatusBadge } from "../components/ui/status-badge";
import { YamlViewDialog } from "../components/ui/yaml-view-dialog";
import { useFavorites } from "../lib/favorites";
import { useOpenAPIDoc } from "../lib/openapi";
import { useWatch } from "../hooks/use-watch";
import type { ClusterEvent, MetricsRow, Pod, PodContainer, PodDetail, PodToleration, PodVolume, WatchFrame } from "../lib/api";
import { api } from "../lib/api";
import { cn, formatAge } from "../lib/utils";

type SortKey = "name" | "namespace" | "status" | "restarts" | "age" | "node";

type PodsPageProps = {
  selectedNamespaces: string[];
};

const pageSize = 10;

export function PodsPage({ selectedNamespaces }: PodsPageProps) {
  const { clusterId = "" } = useParams();
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
  const selectedNamespaceKey = selectedNamespaces.join(",");

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
    gvr: { group: "", version: "v1", resource: "pods", kind: "Pod", namespaced: true },
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
    }
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
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Failed to load pod detail");
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, selectedPod]);

  const sortedPods = useMemo(() => {
    return [...pods].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      const result =
        typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue));
      return sortDirection === "asc" ? result : -result;
    });
  }, [pods, sortDirection, sortKey]);

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
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pods</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedNamespaces.length === 0
              ? "All namespaces in the active cluster."
              : `Filtered to ${selectedNamespaces.join(", ")}.`}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void loadPods()} disabled={loading}>
          <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
      <div className="text-xs uppercase text-muted-foreground">Watch: {watchStatus}</div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="k8s-table">
          <thead className="k8s-thead">
            <tr>
              <SortableHeader label="Name" sortKey="name" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Namespace" sortKey="namespace" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Status" sortKey="status" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <th className="k8s-th">Ready</th>
              <SortableHeader label="Restarts" sortKey="restarts" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Age" sortKey="age" active={sortKey} direction={sortDirection} onSort={toggleSort} className="hidden md:table-cell" />
              <SortableHeader label="Node" sortKey="node" active={sortKey} direction={sortDirection} onSort={toggleSort} className="hidden lg:table-cell" />
              <th className="w-12 px-2 py-3" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {pagePods.map((pod) => {
              const podRoute = `/clusters/${clusterId}/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}`;
              return (
                <tr
                  key={`${pod.namespace}/${pod.name}`}
                  className="table-row-hover k8s-row"
                  onClick={() => setSelectedPod(pod)}
                >
                  <td className="k8s-td-name">{pod.name}</td>
                  <td className="k8s-td-muted">{pod.namespace}</td>
                  <td className="k8s-td">
                    <StatusBadge status={pod.status} />
                  </td>
                  <td className="k8s-td-muted">{pod.ready}</td>
                  <td className="k8s-td-numeric">{pod.restarts}</td>
                  <td className="k8s-td-muted hidden md:table-cell">{pod.age}</td>
                  <td className="k8s-td-muted hidden max-w-64 truncate lg:table-cell">{pod.node}</td>
                  <td className="k8s-td-actions" onClick={(event) => event.stopPropagation()}>
                    <ActionMenu
                      label={`Actions for ${pod.name}`}
                      items={[
                        { label: "View details", icon: <FileCode2 className="h-3.5 w-3.5" />, onClick: () => setSelectedPod(pod) },
                        { label: "Logs", icon: <ScrollText className="h-3.5 w-3.5" />, onClick: () => navigate(`${podRoute}/logs`) },
                        { label: "Exec", icon: <TerminalSquare className="h-3.5 w-3.5" />, onClick: () => navigate(`${podRoute}/exec`) },
                        { label: "Attach", icon: <PlugZap className="h-3.5 w-3.5" />, onClick: () => navigate(`${podRoute}/attach`) },
                        { label: "Port-forward", icon: <Plug className="h-3.5 w-3.5" />, onClick: () => navigate(`${podRoute}/port-forward`) }
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
            {pods.length === 0 ? (
              <tr>
                <td className="bg-card px-4 py-8 text-center text-muted-foreground" colSpan={8}>
                  {loading ? "Loading pods..." : "No pods found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <span>
            {sortedPods.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, sortedPods.length)} of {sortedPods.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-16 text-center">
              {page} / {pageCount}
            </span>
            <Button variant="ghost" size="icon" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {selectedPod ? (
        <PodDrawer
          clusterId={clusterId}
          pod={selectedPod}
          detail={podDetail}
          error={detailError}
          onClose={() => {
            setSelectedPod(null);
            setPodDetail(null);
            setDetailError("");
          }}
        />
      ) : null}
    </div>
  );
}


function PodDrawer({
  clusterId,
  pod,
  detail,
  error,
  onClose
}: {
  clusterId: string;
  pod: Pod;
  detail: PodDetail | null;
  error: string;
  onClose: () => void;
}) {
  const labels = Object.entries(detail?.labels ?? {});
  const { isFavorite, toggleFavorite } = useFavorites(clusterId);
  const openApiDoc = useOpenAPIDoc(clusterId);
  const pinned = isFavorite({ kind: "Pod", resource: "pods", namespace: pod.namespace, name: pod.name });
  const [metric, setMetric] = useState<MetricsRow | null>(null);
  const [metricError, setMetricError] = useState("");
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [yamlDialogOpen, setYamlDialogOpen] = useState(false);
  const [resourceYaml, setResourceYaml] = useState("");
  // The Pods page shows YAML read-only (allowEdit={false} below); editing a Pod
  // is done through the generic resource drawer. editedYaml/editMode satisfy the
  // dialog's required props but stay inert here by design.
  const [editedYaml, setEditedYaml] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlError, setYamlError] = useState("");
  const [editMode, setEditMode] = useState(false);
  const navigate = useNavigate();
  const podRoute = `/clusters/${clusterId}/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}`;

  const loadMetric = useCallback(async () => {
    if (!clusterId) return;
    try {
      const data = await api.metrics(clusterId);
      if (!data.available) {
        setMetric(null);
        setMetricError("metrics-server is not available for this cluster.");
        return;
      }
      const row = data.pods.find((item) => item.namespace === pod.namespace && item.name === pod.name) ?? null;
      setMetric(row);
      setMetricError(row ? "" : "No metrics sample reported for this pod.");
    } catch (err) {
      setMetric(null);
      setMetricError(err instanceof Error ? err.message : "Failed to load pod metrics");
    }
  }, [clusterId, pod.name, pod.namespace]);

  useEffect(() => {
    void loadMetric();
    const timer = window.setInterval(() => void loadMetric(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadMetric]);

  const loadEvents = useCallback(async () => {
    if (!clusterId) return;
    setEventsLoading(true);
    setEventsError("");
    try {
      const rows = await api.events(clusterId, [pod.namespace]);
      setEvents(
        rows.filter(
          (event) =>
            event.regardingKind === "Pod" &&
            event.regardingName === pod.name &&
            (event.regardingNamespace === pod.namespace || event.namespace === pod.namespace)
        )
      );
    } catch (err) {
      setEvents([]);
      setEventsError(err instanceof Error ? err.message : "Failed to load pod events");
    } finally {
      setEventsLoading(false);
    }
  }, [clusterId, pod.name, pod.namespace]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    setYamlDialogOpen(false);
    setResourceYaml("");
    setEditedYaml("");
    setYamlError("");
    setEditMode(false);
  }, [pod.name, pod.namespace]);

  const openYaml = useCallback(async () => {
    if (!clusterId) return;
    setYamlLoading(true);
    setYamlError("");
    try {
      const resource = await api.resourceDetail(clusterId, "pods", pod.namespace, pod.name);
      const nextYaml = dump(resource, { lineWidth: -1, noRefs: true });
      setResourceYaml(nextYaml);
      setEditedYaml(nextYaml);
      setEditMode(false);
      setYamlDialogOpen(true);
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : "Failed to load pod YAML");
    } finally {
      setYamlLoading(false);
    }
  }, [clusterId, pod.name, pod.namespace]);

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm">
        <aside className="h-full w-full max-w-xl animate-slide-in-right overflow-y-auto border-l border-border bg-card shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card/95 p-5 backdrop-blur">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={pod.status === "Running" ? "success" : "warning"}>{pod.status}</Badge>
              <span className="text-xs text-muted-foreground">{pod.namespace}</span>
            </div>
            <h2 className="truncate text-lg font-semibold">{pod.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ActionMenu
              label={`Open ${pod.name} actions`}
              items={[
                {
                  label: yamlLoading ? "Loading YAML..." : "View YAML",
                  icon: <FileCode2 className="h-3.5 w-3.5" />,
                  onClick: () => void openYaml(),
                  disabled: yamlLoading
                },
                {
                  label: "Logs",
                  icon: <ScrollText className="h-3.5 w-3.5" />,
                  onClick: () => navigate(`${podRoute}/logs`)
                },
                {
                  label: "Exec",
                  icon: <TerminalSquare className="h-3.5 w-3.5" />,
                  onClick: () => navigate(`${podRoute}/exec`)
                },
                {
                  label: "Attach",
                  icon: <PlugZap className="h-3.5 w-3.5" />,
                  onClick: () => navigate(`${podRoute}/attach`)
                },
                {
                  label: "Port-forward",
                  icon: <Plug className="h-3.5 w-3.5" />,
                  onClick: () => navigate(`${podRoute}/port-forward`)
                }
              ]}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleFavorite({ kind: "Pod", resource: "pods", namespace: pod.namespace, name: pod.name, route: "pods" })}
              aria-label={pinned ? `Unpin ${pod.name}` : `Pin ${pod.name}`}
              aria-pressed={pinned}
              title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
            >
              <Star className={cn("h-4 w-4", pinned ? "fill-yellow-400 text-yellow-400" : "")} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close pod detail">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-6 p-5">
          {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          {yamlError ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{yamlError}</div> : null}
          {!detail && !error ? <div className="shimmer h-24 rounded-lg bg-muted" /> : null}
          {detail ? (
            <>
              <section className="grid grid-cols-2 gap-3 text-sm">
                <Info label="Ready" value={detail.ready} />
                <Info label="Restarts" value={detail.restarts} />
                <Info label="Pod IPs" value={listSummary(detail.podIPs, detail.podIP)} />
                <Info label="Host IPs" value={listSummary(detail.hostIPs, detail.hostIP)} />
                <Info label="Node" value={detail.node || "-"} />
                <Info label="Service Account" value={detail.serviceAccountName || "-"} />
                <Info label="QoS Class" value={detail.qosClass || "-"} />
                <Info label="Priority" value={detail.priority ?? "-"} />
                <Info label="Created" value={formatTimestamp(detail.createdAt)} />
                <Info label="UID" value={detail.uid || "-"} />
              </section>

              <MetricSummary title="Pod metrics" metric={metric} unavailable={metricError} />

              <RelatedResourcesSection
                clusterId={clusterId}
                namespace={detail.namespace}
                node={detail.node}
                serviceAccount={detail.serviceAccountName}
                owners={detail.ownerReferences ?? []}
                onNavigate={navigate}
              />

              <ContainerDetailsSection title="Containers" containers={detail.containers} />
              {detail.initContainers && detail.initContainers.length > 0 ? (
                <ContainerDetailsSection title="Init Containers" containers={detail.initContainers} />
              ) : null}

              <VolumesSection volumes={detail.volumes ?? []} />
              <TolerationsSection tolerations={detail.tolerations ?? []} />

              <section>
                <h3 className="mb-2 text-sm font-semibold">Conditions</h3>
                <div className="space-y-2">
                  {detail.conditions.map((condition) => (
                    <div key={condition.type} className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm">
                      <div>
                        <div className="font-medium">{condition.type}</div>
                        {condition.message ? <div className="mt-1 text-xs text-muted-foreground">{condition.message}</div> : null}
                      </div>
                      <Badge tone={condition.status === "True" ? "success" : "muted"}>{condition.status}</Badge>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Labels</h3>
                <KeyValuePills entries={labels} emptyText="No labels." />
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Annotations</h3>
                <KeyValuePills entries={Object.entries(detail.annotations ?? {})} emptyText="No annotations." />
              </section>

              <PodEventsSection events={events} loading={eventsLoading} error={eventsError} onRefresh={loadEvents} />
            </>
          ) : null}
        </div>
        </aside>
      </div>
      <YamlViewDialog
        open={yamlDialogOpen}
        onClose={() => setYamlDialogOpen(false)}
        title={`Pod YAML: ${pod.name}`}
        yaml={resourceYaml}
        editedYaml={editedYaml}
        onEditedYamlChange={setEditedYaml}
        editMode={editMode}
        onEditModeChange={setEditMode}
        allowEdit={false}
        readOnly
        kind="Pod"
        apiVersion="v1"
        openApiDoc={openApiDoc}
      />
    </>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function KeyValuePills({ entries, emptyText }: { entries: [string, string][]; emptyText: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {entries.length > 0 ? (
        entries.map(([key, value]) => (
          <span key={key} className="max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground" title={`${key}=${value}`}>
            {key}={value}
          </span>
        ))
      ) : (
        <span className="text-sm text-muted-foreground">{emptyText}</span>
      )}
    </div>
  );
}

function PodEventsSection({
  events,
  loading,
  error,
  onRefresh
}: {
  events: ClusterEvent[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Events</h3>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCcw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>
      {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      {!error && loading ? <div className="shimmer h-16 rounded-md bg-muted" /> : null}
      {!error && !loading && events.length === 0 ? <span className="text-sm text-muted-foreground">No events.</span> : null}
      {!error && events.length > 0 ? (
        <div className="space-y-2">
          {events.slice(0, 8).map((event) => (
            <div key={`${event.namespace ?? ""}/${event.name}/${event.lastTimestamp}`} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate font-medium">{event.reason || event.action || "Event"}</div>
                <Badge tone={event.type === "Warning" ? "warning" : "muted"}>{event.type || "Normal"}</Badge>
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{event.note || "-"}</div>
              <div className="mt-2 text-xs text-muted-foreground">{event.age || event.lastTimestamp || event.eventTime}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RelatedResourcesSection({
  clusterId,
  namespace,
  node,
  serviceAccount,
  owners,
  onNavigate
}: {
  clusterId: string;
  namespace: string;
  node?: string;
  serviceAccount?: string;
  owners: PodDetail["ownerReferences"];
  onNavigate: (path: string) => void;
}) {
  const controller = owners?.find((owner) => owner.controller) ?? owners?.[0];
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Related Resources</h3>
      <div className="space-y-2 rounded-md border border-border p-3 text-sm">
        <RelatedResourceRow
          label="Node"
          value={node || "-"}
          onClick={node ? () => onNavigate(`/clusters/${clusterId}/nodes`) : undefined}
        />
        <RelatedResourceRow
          label="Service Account"
          value={serviceAccount || "-"}
          onClick={serviceAccount ? () => onNavigate(`/clusters/${clusterId}/serviceaccounts`) : undefined}
        />
        <RelatedResourceRow
          label="Controlled By"
          value={controller ? `${controller.kind}/${controller.name}` : "-"}
          meta={controller?.apiVersion}
        />
        <RelatedResourceRow label="Namespace" value={namespace} onClick={() => onNavigate(`/clusters/${clusterId}/namespaces`)} />
      </div>
    </section>
  );
}

function RelatedResourceRow({
  label,
  value,
  meta,
  onClick
}: {
  label: string;
  value: string;
  meta?: string;
  onClick?: () => void;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <div className="min-w-0">
        {onClick && value !== "-" ? (
          <button type="button" onClick={onClick} className="max-w-full truncate text-left font-medium text-primary hover:underline">
            {value}
          </button>
        ) : (
          <span className="block truncate font-medium">{value}</span>
        )}
        {meta ? <div className="truncate text-xs text-muted-foreground">{meta}</div> : null}
      </div>
    </div>
  );
}

function ContainerDetailsSection({ title, containers }: { title: string; containers: PodContainer[] }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="space-y-2">
        {containers.map((container) => (
          <div key={container.name} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-medium">{container.name}</span>
              <Badge tone={container.ready ? "success" : "warning"}>{container.state}</Badge>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{container.image}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <DetailChip label="Restarts" value={container.restarts} />
              <DetailChip label="Pull Policy" value={container.pullPolicy || "-"} />
              <DetailChip label="Ports" value={portsSummary(container.ports)} />
              <DetailChip label="Requests" value={resourceSummary(container.requests)} />
              <DetailChip label="Limits" value={resourceSummary(container.limits)} className="sm:col-span-2" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function VolumesSection({ volumes }: { volumes: PodVolume[] }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Volumes</h3>
      {volumes.length > 0 ? (
        <div className="divide-y divide-border rounded-md border border-border">
          {volumes.map((volume) => (
            <div key={volume.name} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium">{volume.name}</span>
              <span className="text-xs text-muted-foreground">{volume.type}</span>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">No volumes.</span>
      )}
    </section>
  );
}

function TolerationsSection({ tolerations }: { tolerations: PodToleration[] }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Tolerations</h3>
      {tolerations.length > 0 ? (
        <div className="space-y-2">
          {tolerations.map((toleration, index) => (
            <div key={`${toleration.key ?? ""}-${toleration.effect ?? ""}-${index}`} className="rounded-md border border-border p-3 text-xs">
              <div className="font-mono text-foreground">{toleration.key || "*"}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
                <DetailChip label="Operator" value={toleration.operator || "-"} />
                <DetailChip label="Value" value={toleration.value || "-"} />
                <DetailChip label="Effect" value={toleration.effect || "-"} />
                <DetailChip label="Seconds" value={toleration.tolerationSeconds ?? "-"} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">No tolerations.</span>
      )}
    </section>
  );
}

function DetailChip({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-md bg-muted/60 px-2 py-1.5", className)}>
      <div className="uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium text-foreground" title={String(value)}>
        {value}
      </div>
    </div>
  );
}

function listSummary(values: string[] | undefined, fallback: string) {
  const next = values?.filter(Boolean);
  return next && next.length > 0 ? next.join(", ") : fallback || "-";
}

function portsSummary(ports: number[] | undefined) {
  return ports && ports.length > 0 ? ports.join(", ") : "-";
}

function resourceSummary(values: Record<string, string> | undefined) {
  if (!values || Object.keys(values).length === 0) return "-";
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

function formatTimestamp(value: string | undefined) {
  if (!value) return "-";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleString();
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
  const spec = object.spec && typeof object.spec === "object" ? (object.spec as Record<string, unknown>) : {};
  const status = object.status && typeof object.status === "object" ? (object.status as Record<string, unknown>) : {};
  const containers = Array.isArray(spec.containers) ? spec.containers : [];
  const containerStatuses = Array.isArray(status.containerStatuses) ? status.containerStatuses : [];
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
    status: typeof meta.deletionTimestamp === "string" ? "Terminating" : typeof status.phase === "string" ? status.phase : "",
    restarts,
    age: typeof meta.creationTimestamp === "string" ? formatAge(meta.creationTimestamp) : "",
    node: typeof spec.nodeName === "string" ? spec.nodeName : "",
    ready: `${ready}/${containers.length}`,
    ip: typeof status.podIP === "string" ? status.podIP : ""
  };
}

