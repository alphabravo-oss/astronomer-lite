import { dump } from "js-yaml";
import { Check, ChevronLeft, ChevronRight, FileCode2, Plug, Plus, RefreshCcw, Scale, Search, Star, Trash2, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MetricSummary } from "../components/metrics/metric-summary";
import { Button } from "../components/ui/button";
import { CodeBlock } from "../components/ui/code-block";
import { PageHeader, PageShell } from "../components/ui/page";
import { SortableHeader, type SortDirection } from "../components/ui/sortable-header";
import { StatusBadge } from "../components/ui/status-badge";
import { YamlViewDialog } from "../components/ui/yaml-view-dialog";
import { useWatch } from "../hooks/use-watch";
import type {
  ApplyResponse,
  ClusterEvent,
  DiscoveredResource,
  K8sResourceRow,
  MetricsRow,
  SecretReveal,
  WatchFrame
} from "../lib/api";
import { ApiError, api } from "../lib/api";
import {
  accessCheckFromSettled,
  accessDeniedMessage,
  accessStatusMessage,
  idleAccessCheck,
  isAccessBlocked,
  pendingAccessCheck,
  type AccessCheck
} from "../lib/access";
import { useFavorites } from "../lib/favorites";
import { lookupFieldDoc, useOpenAPIDoc, type OpenAPIDocument } from "../lib/openapi";
import { resourceByRoute } from "../lib/resources";
import { cn, formatAge, record, text } from "../lib/utils";
import {
  accessReviewForResource,
  buildLineDiff,
  buildSplitDiff,
  createTemplate,
  formatNodeDrainMessage,
  hasOwner,
  isApplyConflictError,
  isConfiguredResource,
  isOwnedPodResource,
  isPositiveActionMessage,
  isPositiveApplyMessage,
  isSecretResource,
  isWorkloadResource,
  loadRevisionHistory,
  resourceRowFromObject,
  resourceRowKey,
  resourceUnavailableMessage,
  sameResourceRow,
  serviceEndpointRow,
  serviceEndpointSliceRow,
  stringRecord,
  stripManagedFields,
  summaryValue,
  supportsRevisionHistory,
  supportsScale,
  validateYamlSyntax,
  workloadLabelSelector,
  type ActiveResource,
  type DiffRow,
  type RevisionRow,
  type ServiceEndpointRow
} from "../lib/resource-detail";
import {
  CustomResourceDetailsSection,
  MetadataMap,
  ResourceSpecificSections,
  SecretDataSection,
  ServicePortsSection,
  SummaryField,
  WorkloadDetailsSection
} from "./resource-detail/sections";

const YamlEditor = lazy(() => import("../components/ui/yaml-editor").then((module) => ({ default: module.YamlEditor })));

type SortKey = "name" | "namespace" | "kind" | "status" | "age";
const resourcePageSizeOptions = [25, 50, 100] as const;
const resourcePageSizeStorageKey = "astronomer-lite-resource-page-size";

type ResourceListPageProps = {
  resourceId?: string;
  discoveredResource?: DiscoveredResource;
  selectedNamespaces: string[];
  refreshSignal?: number;
};

export function ResourceListPage({ resourceId, discoveredResource, selectedNamespaces, refreshSignal = 0 }: ResourceListPageProps) {
  const { clusterId = "", resource = "" } = useParams();
  const config = resourceByRoute(resourceId ?? resource);
  const activeResource = useMemo<ActiveResource | null>(() => {
    if (discoveredResource) {
      return {
        id: discoveredResource.resource,
        label: discoveredResource.kind || discoveredResource.resource,
        namespaced: discoveredResource.namespaced,
        apiVersion: discoveredResource.groupVersion,
        watchDescriptor: discoveredResource
      };
    }
    if (!config) return null;
    return {
      id: config.id,
      label: config.label,
      namespaced: config.namespaced,
      apiVersion: config.apiGroup ? `${config.apiGroup}/${config.version}` : config.version,
      watchDescriptor: {
        group: config.apiGroup,
        version: config.version,
        resource: config.resource,
        kind: config.label,
        namespaced: config.namespaced
      }
    };
  }, [config, discoveredResource]);
  const [items, setItems] = useState<K8sResourceRow[]>([]);
  const [selected, setSelected] = useState<K8sResourceRow | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("namespace");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => readResourcePageSize());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createYaml, setCreateYaml] = useState("");
  const [validatedCreateYaml, setValidatedCreateYaml] = useState("");
  const [createState, setCreateState] = useState<"idle" | "dry-running" | "applying">("idle");
  const [createError, setCreateError] = useState("");
  const [createResponse, setCreateResponse] = useState<ApplyResponse | null>(null);
  const [createAccess, setCreateAccess] = useState<AccessCheck>(idleAccessCheck);

  const loadResources = useCallback(async () => {
    if (!clusterId || !activeResource) return;
    setLoading(true);
    try {
      const namespaces = activeResource.namespaced ? selectedNamespaces : [];
      const response = discoveredResource
        ? await api.gvrResources(clusterId, discoveredResource, namespaces)
        : await api.resources(clusterId, activeResource.id, namespaces);
      setItems(response.items);
      setError("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && !discoveredResource) {
        setError(resourceUnavailableMessage(activeResource));
      } else {
        setError(err instanceof Error ? err.message : "Failed to load resources");
      }
    } finally {
      setLoading(false);
    }
  }, [activeResource, clusterId, discoveredResource, selectedNamespaces]);

  useEffect(() => {
    void loadResources();
    setSelected(null);
    setPage(1);
  }, [loadResources, refreshSignal]);

  useEffect(() => {
    if (!clusterId || !activeResource) {
      setCreateAccess(idleAccessCheck);
      return;
    }
    let cancelled = false;
    setCreateAccess(pendingAccessCheck);
    void Promise.allSettled([
      api.canI(clusterId, accessReviewForResource(activeResource.watchDescriptor, "create", activeResource.namespaced ? selectedNamespaces[0] || "default" : undefined))
    ]).then(([result]) => {
      if (!cancelled) setCreateAccess(accessCheckFromSettled(result));
    });
    return () => {
      cancelled = true;
    };
  }, [activeResource, clusterId, selectedNamespaces]);

  const watchStatus = useWatch({
    clusterId,
    gvr: activeResource?.watchDescriptor ?? null,
    namespaces: activeResource?.namespaced ? selectedNamespaces : [],
    errorMessage: "Resource watch failed",
    onReset: () => void loadResources(),
    onError: (message) => setError(message),
    onFrame: (frame: WatchFrame) => {
      if (!frame.object || frame.type === "BOOKMARK") return;
      const row = resourceRowFromObject(frame.object);
      if (!row) return;
      const rowKey = resourceRowKey(row);
      setItems((current) => {
        const index = current.findIndex((item) => resourceRowKey(item) === rowKey);
        if (frame.type === "DELETED") {
          if (index < 0) return current;
          const next = current.slice();
          next.splice(index, 1);
          return next;
        }
        if (index < 0) return [...current, row];
        if (sameResourceRow(current[index], row)) return current;
        const next = current.slice();
        next[index] = row;
        return next;
      });
    }
  });

  useEffect(() => {
    if (!clusterId || !activeResource || !selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError("");
    const request = discoveredResource
      ? api.gvrResourceDetail(clusterId, discoveredResource, selected.namespace ?? "", selected.name)
      : api.resourceDetail(clusterId, activeResource.id, selected.namespace ?? "", selected.name);
    request
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Failed to load resource detail");
      });
    return () => {
      cancelled = true;
    };
  }, [activeResource, clusterId, discoveredResource, selected]);

  const filteredItems = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return items;
    return items.filter((item) =>
      [item.name, item.namespace, item.kind, item.status, item.age]
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }, [items, query]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const result = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""));
      return sortDirection === "asc" ? result : -result;
    });
  }, [filteredItems, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const pageItems = useMemo(() => sortedItems.slice((page - 1) * pageSize, page * pageSize), [page, pageSize, sortedItems]);

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
    setPage(1);
  }

  function changePageSize(nextPageSize: number) {
    setPageSize(nextPageSize);
    setPage(1);
    window.localStorage.setItem(resourcePageSizeStorageKey, String(nextPageSize));
  }

  function openCreateDialog() {
    if (!activeResource || isAccessBlocked(createAccess)) return;
    setCreateYaml(createTemplate(activeResource, selectedNamespaces[0]));
    setValidatedCreateYaml("");
    setCreateError("");
    setCreateResponse(null);
    setCreateOpen(true);
  }

  function updateCreateYaml(value: string) {
    setCreateYaml(value);
    setValidatedCreateYaml("");
    setCreateError("");
    setCreateResponse(null);
  }

  async function dryRunCreateYaml() {
    if (!clusterId || !createYaml.trim() || isAccessBlocked(createAccess)) return;
    setCreateState("dry-running");
    setCreateError("");
    try {
      const response = await api.applyManifests(clusterId, createYaml, true);
      setCreateResponse(response);
      setValidatedCreateYaml(createYaml);
    } catch (err) {
      setCreateResponse(null);
      setValidatedCreateYaml("");
      setCreateError(err instanceof Error ? err.message : "Failed to dry-run manifest");
    } finally {
      setCreateState("idle");
    }
  }

  async function applyCreateYaml() {
    if (!clusterId || !validatedCreateYaml || createYaml !== validatedCreateYaml || isAccessBlocked(createAccess)) return;
    setCreateState("applying");
    setCreateError("");
    try {
      const response = await api.applyManifests(clusterId, createYaml, false);
      setCreateResponse(response);
      setValidatedCreateYaml("");
      setCreateYaml("");
      setCreateOpen(false);
      await loadResources();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to apply manifest");
    } finally {
      setCreateState("idle");
    }
  }

  if (!activeResource) {
    return <div className="text-sm text-muted-foreground">Unknown resource type.</div>;
  }

  return (
    <PageShell>
      <PageHeader
        title={activeResource.label}
        description={
          <>
            {activeResource.apiVersion ? <span className="mr-2 font-mono text-xs">{activeResource.apiVersion}/{activeResource.id}</span> : null}
            {activeResource.namespaced && selectedNamespaces.length > 0
              ? `Filtered to ${selectedNamespaces.join(", ")}.`
              : activeResource.namespaced
                ? "All namespaces in the active cluster."
                : "Cluster-scoped Kubernetes resources."}
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={openCreateDialog}
              disabled={isAccessBlocked(createAccess)}
              title={accessStatusMessage(createAccess) || undefined}
            >
              <Plus className="h-4 w-4" />
              Create YAML
            </Button>
            <Button variant="secondary" onClick={() => void loadResources()} disabled={loading}>
              <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </>
        }
      />

      <div className="text-xs uppercase text-muted-foreground">Watch: {watchStatus}</div>

      {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              id={`${activeResource.id}-filter`}
              name={`${activeResource.id}-filter`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              placeholder={`Filter ${activeResource.label.toLowerCase()}`}
            />
          </div>
        </div>
        <table className="k8s-table">
          <thead className="k8s-thead">
            <tr>
              <SortableHeader label="Name" sortKey="name" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Namespace" sortKey="namespace" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Kind" sortKey="kind" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Status" sortKey="status" active={sortKey} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Age" sortKey="age" active={sortKey} direction={sortDirection} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {pageItems.map((item) => (
              <tr key={`${item.namespace ?? "_cluster"}/${item.name}`} className="table-row-hover k8s-row" onClick={() => setSelected(item)}>
                <td className="k8s-td-name">{item.name}</td>
                <td className="k8s-td-muted">{item.namespace || "-"}</td>
                <td className="k8s-td-muted">{item.kind || activeResource.label}</td>
                <td className="k8s-td">
                  {item.status ? <StatusBadge status={item.status} label={item.status} /> : <span className="text-muted-foreground">-</span>}
                </td>
                <td className="k8s-td-muted">{item.age}</td>
              </tr>
            ))}
            {sortedItems.length === 0 ? (
              <tr>
                <td className="bg-card px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                  {loading ? "Loading resources..." : "No resources found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            {sortedItems.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, sortedItems.length)} of {sortedItems.length}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(event) => changePageSize(Number(event.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                aria-label="Rows per page"
              >
                {resourcePageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="ghost" size="icon" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-16 text-center">
              {page} / {pageCount}
            </span>
            <Button variant="ghost" size="icon" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {selected ? (
        <ResourceDrawer
          clusterId={clusterId}
          item={selected}
          detail={detail}
          error={detailError}
          activeResource={activeResource}
          discoveredResource={discoveredResource}
          onApplied={(nextDetail) => {
            setDetail(nextDetail);
            void loadResources();
          }}
          onDeleted={(deleted) => {
            setItems((current) => current.filter((item) => resourceRowKey(item) !== resourceRowKey(deleted)));
            setSelected(null);
            setDetail(null);
            setDetailError("");
            void loadResources();
          }}
          onClose={() => {
            setSelected(null);
            setDetail(null);
            setDetailError("");
          }}
        />
      ) : null}
      <CreateYamlDialog
        open={createOpen}
        yaml={createYaml}
        validated={validatedCreateYaml !== "" && createYaml === validatedCreateYaml}
        state={createState}
        error={createError}
        response={createResponse}
        access={createAccess}
        onYamlChange={updateCreateYaml}
        onDryRun={() => void dryRunCreateYaml()}
        onApply={() => void applyCreateYaml()}
        onClose={() => setCreateOpen(false)}
      />
    </PageShell>
  );
}

function readResourcePageSize() {
  if (typeof window === "undefined") return resourcePageSizeOptions[0];
  const stored = Number(window.localStorage.getItem(resourcePageSizeStorageKey));
  return resourcePageSizeOptions.includes(stored as (typeof resourcePageSizeOptions)[number]) ? stored : resourcePageSizeOptions[0];
}

function CreateYamlDialog({
  open,
  yaml,
  validated,
  state,
  error,
  response,
  access,
  onYamlChange,
  onDryRun,
  onApply,
  onClose
}: {
  open: boolean;
  yaml: string;
  validated: boolean;
  state: "idle" | "dry-running" | "applying";
  error: string;
  response: ApplyResponse | null;
  access: AccessCheck;
  onYamlChange: (value: string) => void;
  onDryRun: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close create YAML dialog" />
      <section className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold">
              <Plus className="h-4 w-4" />
              Create YAML
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Dry-run the manifest against Kubernetes before applying it.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close create YAML dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <textarea
            id="create-resource-yaml"
            name="create-resource-yaml"
            value={yaml}
            onChange={(event) => onYamlChange(event.target.value)}
            className="min-h-[26rem] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
          {error ? <div className="mt-3 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          {response ? (
            <div
              className={cn(
                "mt-3 rounded-md border p-3 text-sm",
                response.dryRun ? "border-status-warning/35 bg-status-warning/10 text-status-warning" : "border-status-success/35 bg-status-success/10 text-status-success"
              )}
            >
              <div className="mb-2 flex items-center gap-2 font-medium">
                <Check className="h-4 w-4" />
                {response.dryRun ? "Dry run passed" : "Applied"} for {response.items.length} resource{response.items.length === 1 ? "" : "s"}.
              </div>
              <div className="flex flex-wrap gap-2">
                {response.items.map((item) => (
                  <span key={`${item.apiVersion}/${item.kind}/${item.namespace ?? "_cluster"}/${item.name}`} className="rounded-md bg-background/70 px-2 py-1 font-mono text-xs">
                    {item.kind}/{item.namespace ? `${item.namespace}/` : ""}{item.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onDryRun} disabled={state !== "idle" || !yaml.trim() || isAccessBlocked(access)} title={accessStatusMessage(access) || undefined}>
            {state === "dry-running" ? "Dry-running..." : "Dry run"}
          </Button>
          <Button onClick={onApply} disabled={state !== "idle" || !validated || isAccessBlocked(access)} title={accessStatusMessage(access) || undefined}>
            {state === "applying" ? "Applying..." : "Apply"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ResourceDrawer({
  clusterId,
  item,
  detail,
  error,
  activeResource,
  discoveredResource,
  onApplied,
  onDeleted,
  onClose
}: {
  clusterId: string;
  item: K8sResourceRow;
  detail: Record<string, unknown> | null;
  error: string;
  activeResource: ActiveResource;
  discoveredResource?: DiscoveredResource;
  onApplied: (detail: Record<string, unknown>) => void;
  onDeleted: (item: K8sResourceRow) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [view, setView] = useState<"summary" | "events" | "yaml" | "json">("summary");
  const [editMode, setEditMode] = useState(false);
  const [yamlDialogOpen, setYamlDialogOpen] = useState(false);
  const [editedYaml, setEditedYaml] = useState("");
  const [validatedYaml, setValidatedYaml] = useState("");
  const [forceApplyValidated, setForceApplyValidated] = useState(false);
  const [applyConflict, setApplyConflict] = useState(false);
  const [applyState, setApplyState] = useState<"idle" | "dry-running" | "applying">("idle");
  const [applyMessage, setApplyMessage] = useState("");
  const [preRefreshYaml, setPreRefreshYaml] = useState("");
  const [actionState, setActionState] = useState<"idle" | "scaling" | "deleting" | "cordoning" | "draining" | "rolling-back">("idle");
  const [rollbackRevision, setRollbackRevision] = useState<number | null>(null);
  const openApiDoc = useOpenAPIDoc(clusterId);
  const { isFavorite, toggleFavorite } = useFavorites(clusterId);
  const pinned = isFavorite({ kind: item.kind, resource: activeResource.id, namespace: item.namespace, name: item.name });
  const [actionMessage, setActionMessage] = useState("");
  const [replicas, setReplicas] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [drainConfirm, setDrainConfirm] = useState("");
  const [drainForce, setDrainForce] = useState(false);
  const [drainDeleteEmptyDirData, setDrainDeleteEmptyDirData] = useState(false);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, SecretReveal>>({});
  const [revealingSecretKey, setRevealingSecretKey] = useState("");
  const [secretError, setSecretError] = useState("");
  const [nodeMetric, setNodeMetric] = useState<MetricsRow | null>(null);
  const [nodeMetricError, setNodeMetricError] = useState("");
  const [ownedPods, setOwnedPods] = useState<K8sResourceRow[]>([]);
  const [ownedPodsLoading, setOwnedPodsLoading] = useState(false);
  const [ownedPodsError, setOwnedPodsError] = useState("");
  const [ownedJobs, setOwnedJobs] = useState<K8sResourceRow[]>([]);
  const [ownedJobsLoading, setOwnedJobsLoading] = useState(false);
  const [ownedJobsError, setOwnedJobsError] = useState("");
  const [revisionHistory, setRevisionHistory] = useState<RevisionRow[]>([]);
  const [revisionHistoryLoading, setRevisionHistoryLoading] = useState(false);
  const [revisionHistoryError, setRevisionHistoryError] = useState("");
  const [serviceEndpoints, setServiceEndpoints] = useState<ServiceEndpointRow[]>([]);
  const [serviceEndpointsLoading, setServiceEndpointsLoading] = useState(false);
  const [serviceEndpointsError, setServiceEndpointsError] = useState("");
  const [serviceEndpointSlices, setServiceEndpointSlices] = useState<ServiceEndpointRow[]>([]);
  const [serviceEndpointSlicesLoading, setServiceEndpointSlicesLoading] = useState(false);
  const [serviceEndpointSlicesError, setServiceEndpointSlicesError] = useState("");
  const [namespaceQuotas, setNamespaceQuotas] = useState<Record<string, unknown>[]>([]);
  const [namespaceQuotasLoading, setNamespaceQuotasLoading] = useState(false);
  const [namespaceQuotasError, setNamespaceQuotasError] = useState("");
  const [namespaceLimitRanges, setNamespaceLimitRanges] = useState<Record<string, unknown>[]>([]);
  const [namespaceLimitRangesLoading, setNamespaceLimitRangesLoading] = useState(false);
  const [namespaceLimitRangesError, setNamespaceLimitRangesError] = useState("");
  const [nodePods, setNodePods] = useState<K8sResourceRow[]>([]);
  const [nodePodsLoading, setNodePodsLoading] = useState(false);
  const [nodePodsError, setNodePodsError] = useState("");
  const [objectEvents, setObjectEvents] = useState<ClusterEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [updateAccess, setUpdateAccess] = useState<AccessCheck>(idleAccessCheck);
  const [deleteAccess, setDeleteAccess] = useState<AccessCheck>(idleAccessCheck);
  const [scaleAccess, setScaleAccess] = useState<AccessCheck>(idleAccessCheck);
  const cleanedDetail = useMemo(() => (detail ? stripManagedFields(detail) : null), [detail]);
  const yaml = useMemo(() => (cleanedDetail ? dump(cleanedDetail, { lineWidth: -1, noRefs: true }) : ""), [cleanedDetail]);
  const json = useMemo(() => (cleanedDetail ? JSON.stringify(cleanedDetail, null, 2) : ""), [cleanedDetail]);
  const diffRows = useMemo(() => buildLineDiff(yaml, editedYaml), [editedYaml, yaml]);
  const yamlValidationError = useMemo(() => validateYamlSyntax(editedYaml), [editedYaml]);
  const hasYamlChanges = editedYaml !== yaml;
  const canApplyValidatedYaml = validatedYaml !== "" && editedYaml === validatedYaml;
  const scalable = supportsScale(activeResource.watchDescriptor);
  const nodeUnschedulable = activeResource.id === "nodes" && Boolean(record(record(detail).spec).unschedulable);
  const secretReadOnly = isSecretResource(item, activeResource);
  const canEdit = !secretReadOnly && !isAccessBlocked(updateAccess);
  const canDelete = !isAccessBlocked(deleteAccess);
  const canScale = scalable && !isAccessBlocked(scaleAccess);
  const editHint = secretReadOnly
    ? "Secret YAML is read-only because values are masked."
    : accessStatusMessage(updateAccess) || "Edit uses Kubernetes server-side apply.";

  useEffect(() => {
    setEditedYaml(yaml);
    setValidatedYaml("");
    setForceApplyValidated(false);
    setApplyConflict(false);
  }, [yaml]);

  useEffect(() => {
    setRevealedSecrets({});
    setRevealingSecretKey("");
    setSecretError("");
    setActionMessage("");
    setDeleteConfirm("");
    setDrainConfirm("");
    setDrainForce(false);
    setDrainDeleteEmptyDirData(false);
    setYamlDialogOpen(false);
    setPreRefreshYaml("");
    setObjectEvents([]);
    setEventsError("");
    setOwnedPods([]);
    setOwnedPodsError("");
    setOwnedJobs([]);
    setOwnedJobsError("");
    setRevisionHistory([]);
    setRevisionHistoryError("");
    setServiceEndpoints([]);
    setServiceEndpointsError("");
    setServiceEndpointSlices([]);
    setServiceEndpointSlicesError("");
    setNamespaceQuotas([]);
    setNamespaceQuotasError("");
    setNamespaceLimitRanges([]);
    setNamespaceLimitRangesError("");
    setNodePods([]);
    setNodePodsError("");
  }, [item.name, item.namespace]);

  useEffect(() => {
    let cancelled = false;
    const namespace = activeResource.namespaced ? item.namespace || undefined : undefined;
    const descriptor = activeResource.watchDescriptor;
    const updateRequest = accessReviewForResource(descriptor, "patch", namespace, item.name);
    const deleteRequest = accessReviewForResource(descriptor, "delete", namespace, item.name);
    const scaleRequest = scalable ? accessReviewForResource(descriptor, "patch", namespace, item.name, "scale") : null;
    setUpdateAccess(pendingAccessCheck);
    setDeleteAccess(pendingAccessCheck);
    setScaleAccess(scaleRequest ? pendingAccessCheck : idleAccessCheck);
    void Promise.allSettled([
      api.canI(clusterId, updateRequest),
      api.canI(clusterId, deleteRequest),
      scaleRequest ? api.canI(clusterId, scaleRequest) : Promise.resolve(null)
    ]).then(([updateResult, deleteResult, scaleResult]) => {
      if (cancelled) return;
      setUpdateAccess(accessCheckFromSettled(updateResult));
      setDeleteAccess(accessCheckFromSettled(deleteResult));
      setScaleAccess(accessCheckFromSettled(scaleResult));
    });
    return () => {
      cancelled = true;
    };
  }, [activeResource.namespaced, activeResource.watchDescriptor, clusterId, item.name, item.namespace, scalable]);

  useEffect(() => {
    if (!canEdit) setEditMode(false);
  }, [canEdit]);

  useEffect(() => {
    if (!detail || !scalable) {
      setReplicas("");
      return;
    }
    const spec = record(detail.spec);
    const value = spec.replicas;
    setReplicas(typeof value === "number" ? String(value) : "");
  }, [detail, scalable]);

  const loadNodeMetric = useCallback(async () => {
    if (activeResource.id !== "nodes" || !item.name) return;
    try {
      const data = await api.metrics(clusterId);
      if (!data.available) {
        setNodeMetric(null);
        setNodeMetricError("metrics-server is not available for this cluster.");
        return;
      }
      const row = data.nodes.find((node) => node.name === item.name) ?? null;
      setNodeMetric(row);
      setNodeMetricError(row ? "" : "No metrics sample reported for this node.");
    } catch (err) {
      setNodeMetric(null);
      setNodeMetricError(err instanceof Error ? err.message : "Failed to load node metrics");
    }
  }, [activeResource.id, clusterId, item.name]);

  useEffect(() => {
    setNodeMetric(null);
    setNodeMetricError("");
    if (activeResource.id !== "nodes") return;
    void loadNodeMetric();
    const timer = window.setInterval(() => void loadNodeMetric(), 15_000);
    return () => window.clearInterval(timer);
  }, [activeResource.id, loadNodeMetric]);

  useEffect(() => {
    const selector = cleanedDetail ? workloadLabelSelector(cleanedDetail) : "";
    if (!cleanedDetail || !item.namespace || !selector || !isOwnedPodResource(activeResource.id, text(cleanedDetail.kind))) {
      setOwnedPods([]);
      setOwnedPodsError("");
      setOwnedPodsLoading(false);
      return;
    }
    let cancelled = false;
    setOwnedPodsLoading(true);
    setOwnedPodsError("");
    void api
      .resources(clusterId, "pods", [item.namespace], selector)
      .then((response) => {
        if (!cancelled) setOwnedPods(response.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setOwnedPods([]);
          setOwnedPodsError(err instanceof Error ? err.message : "Failed to load owned Pods");
        }
      })
      .finally(() => {
        if (!cancelled) setOwnedPodsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeResource.id, cleanedDetail, clusterId, item.namespace]);

  useEffect(() => {
    const kind = cleanedDetail ? text(cleanedDetail.kind) : "";
    if (!cleanedDetail || !item.namespace || kind !== "CronJob") {
      setOwnedJobs([]);
      setOwnedJobsError("");
      setOwnedJobsLoading(false);
      return;
    }
    let cancelled = false;
    setOwnedJobsLoading(true);
    setOwnedJobsError("");
    void api
      .resources(clusterId, "jobs", [item.namespace])
      .then((response) => {
        if (!cancelled) {
          setOwnedJobs(response.items.filter((row) => hasOwner(row, "CronJob", item.name, text(record(cleanedDetail.metadata).uid))));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setOwnedJobs([]);
          setOwnedJobsError(err instanceof Error ? err.message : "Failed to load owned Jobs");
        }
      })
      .finally(() => {
        if (!cancelled) setOwnedJobsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cleanedDetail, clusterId, item.name, item.namespace]);

  useEffect(() => {
    const kind = cleanedDetail ? text(cleanedDetail.kind) : "";
    if (!cleanedDetail || !item.namespace || !supportsRevisionHistory(kind)) {
      setRevisionHistory([]);
      setRevisionHistoryError("");
      setRevisionHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setRevisionHistoryLoading(true);
    setRevisionHistoryError("");
    loadRevisionHistory(clusterId, item.namespace, item.name, cleanedDetail)
      .then((rows) => {
        if (!cancelled) setRevisionHistory(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setRevisionHistory([]);
          setRevisionHistoryError(err instanceof Error ? err.message : "Failed to load revision history");
        }
      })
      .finally(() => {
        if (!cancelled) setRevisionHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cleanedDetail, clusterId, item.name, item.namespace]);

  useEffect(() => {
    if (!cleanedDetail || activeResource.id !== "services" || !item.namespace) {
      setServiceEndpoints([]);
      setServiceEndpointsError("");
      setServiceEndpointsLoading(false);
      setServiceEndpointSlices([]);
      setServiceEndpointSlicesError("");
      setServiceEndpointSlicesLoading(false);
      return;
    }
    let cancelled = false;
    setServiceEndpointsLoading(true);
    setServiceEndpointsError("");
    setServiceEndpointSlicesLoading(true);
    setServiceEndpointSlicesError("");
    void api
      .resources(clusterId, "endpoints", [item.namespace])
      .then(async (response) => {
        const matching = response.items.filter((row) => row.name === item.name);
        const details = await Promise.all(matching.map((row) => api.resourceDetail(clusterId, "endpoints", item.namespace ?? "", row.name)));
        if (!cancelled) setServiceEndpoints(details.map(serviceEndpointRow));
      })
      .catch((err) => {
        if (!cancelled) {
          setServiceEndpoints([]);
          setServiceEndpointsError(err instanceof Error ? err.message : "Failed to load Service endpoints");
        }
      })
      .finally(() => {
        if (!cancelled) setServiceEndpointsLoading(false);
      });
    void api
      .resources(clusterId, "endpointslices", [item.namespace], `kubernetes.io/service-name=${item.name}`)
      .then(async (response) => {
        const details = await Promise.all(response.items.map((row) => api.resourceDetail(clusterId, "endpointslices", item.namespace ?? "", row.name)));
        if (!cancelled) setServiceEndpointSlices(details.map(serviceEndpointSliceRow));
      })
      .catch((err) => {
        if (!cancelled) {
          setServiceEndpointSlices([]);
          setServiceEndpointSlicesError(err instanceof Error ? err.message : "Failed to load Service endpoint slices");
        }
      })
      .finally(() => {
        if (!cancelled) setServiceEndpointSlicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeResource.id, cleanedDetail, clusterId, item.name, item.namespace]);

  useEffect(() => {
    if (!cleanedDetail || activeResource.id !== "namespaces") {
      setNamespaceQuotas([]);
      setNamespaceQuotasError("");
      setNamespaceQuotasLoading(false);
      setNamespaceLimitRanges([]);
      setNamespaceLimitRangesError("");
      setNamespaceLimitRangesLoading(false);
      return;
    }
    let cancelled = false;
    setNamespaceQuotasLoading(true);
    setNamespaceLimitRangesLoading(true);
    setNamespaceQuotasError("");
    setNamespaceLimitRangesError("");
    void api
      .resources(clusterId, "resourcequotas", [item.name])
      .then(async (response) => {
        const details = await Promise.all(response.items.map((row) => api.resourceDetail(clusterId, "resourcequotas", item.name, row.name)));
        if (!cancelled) setNamespaceQuotas(details);
      })
      .catch((err) => {
        if (!cancelled) {
          setNamespaceQuotas([]);
          setNamespaceQuotasError(err instanceof Error ? err.message : "Failed to load ResourceQuotas");
        }
      })
      .finally(() => {
        if (!cancelled) setNamespaceQuotasLoading(false);
      });
    void api
      .resources(clusterId, "limitranges", [item.name])
      .then(async (response) => {
        const details = await Promise.all(response.items.map((row) => api.resourceDetail(clusterId, "limitranges", item.name, row.name)));
        if (!cancelled) setNamespaceLimitRanges(details);
      })
      .catch((err) => {
        if (!cancelled) {
          setNamespaceLimitRanges([]);
          setNamespaceLimitRangesError(err instanceof Error ? err.message : "Failed to load LimitRanges");
        }
      })
      .finally(() => {
        if (!cancelled) setNamespaceLimitRangesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeResource.id, cleanedDetail, clusterId, item.name]);

  useEffect(() => {
    if (!cleanedDetail || activeResource.id !== "nodes") {
      setNodePods([]);
      setNodePodsError("");
      setNodePodsLoading(false);
      return;
    }
    let cancelled = false;
    setNodePodsLoading(true);
    setNodePodsError("");
    void api
      .resources(clusterId, "pods", [], "", `spec.nodeName=${item.name},status.phase!=Succeeded,status.phase!=Failed`)
      .then((response) => {
        if (!cancelled) setNodePods(response.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setNodePods([]);
          setNodePodsError(err instanceof Error ? err.message : "Failed to load node Pods");
        }
      })
      .finally(() => {
        if (!cancelled) setNodePodsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeResource.id, cleanedDetail, clusterId, item.name]);

  const loadObjectEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError("");
    try {
      const rows = await api.events(clusterId, item.namespace ? [item.namespace] : []);
      const kind = item.kind || activeResource.watchDescriptor.kind || activeResource.label;
      const next = rows.filter((event) => {
        const sameName = event.regardingName === item.name;
        const sameKind = !kind || event.regardingKind === kind || event.regardingKind === activeResource.label;
        const sameNamespace = !item.namespace || event.regardingNamespace === item.namespace || event.namespace === item.namespace;
        return sameName && sameKind && sameNamespace;
      });
      setObjectEvents(next);
    } catch (err) {
      setObjectEvents([]);
      setEventsError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setEventsLoading(false);
    }
  }, [activeResource.label, activeResource.watchDescriptor.kind, clusterId, item.kind, item.name, item.namespace]);

  useEffect(() => {
    if (view !== "events") return;
    void loadObjectEvents();
  }, [loadObjectEvents, view]);

  function updateEditedYaml(value: string) {
    setEditedYaml(value);
    setValidatedYaml("");
    setForceApplyValidated(false);
    setApplyConflict(false);
    setApplyMessage("");
  }

  function resetEditedYaml() {
    setEditedYaml(yaml);
    setValidatedYaml("");
    setForceApplyValidated(false);
    setApplyConflict(false);
    setPreRefreshYaml("");
    setApplyMessage("");
  }

  async function validateYaml(force = false) {
    if (!cleanedDetail || !canEdit) return;
    if (yamlValidationError) {
      setApplyMessage(yamlValidationError);
      return;
    }
    setApplyState("dry-running");
    setApplyMessage("");
    setApplyConflict(false);
    try {
      await (discoveredResource
        ? api.applyGVRResource(clusterId, discoveredResource, item.namespace ?? "", item.name, editedYaml, true, force)
        : api.applyResource(clusterId, activeResource.id, item.namespace ?? "", item.name, editedYaml, true, force));
      setValidatedYaml(editedYaml);
      setForceApplyValidated(force);
      setApplyMessage(force ? "Force dry run passed. Review the diff, then apply to take ownership of conflicting fields." : "Dry run passed. Review the diff, then apply the validated YAML.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to validate YAML";
      setValidatedYaml("");
      setForceApplyValidated(false);
      const conflict = isApplyConflictError(err, message);
      setApplyConflict(conflict);
      setApplyMessage(conflict ? `${message}\n\nKubernetes reported a server-side apply conflict. Force apply can take ownership of the conflicting fields after a successful force dry run.` : message);
    } finally {
      setApplyState("idle");
    }
  }

  async function applyValidatedYaml() {
    if (!cleanedDetail || !canEdit || !canApplyValidatedYaml) return;
    setApplyState("applying");
    setApplyMessage("");
    try {
      const nextDetail = discoveredResource
        ? await api.applyGVRResource(clusterId, discoveredResource, item.namespace ?? "", item.name, editedYaml, false, forceApplyValidated)
        : await api.applyResource(clusterId, activeResource.id, item.namespace ?? "", item.name, editedYaml, false, forceApplyValidated);
      onApplied(nextDetail);
      setEditMode(false);
      setView("summary");
      setValidatedYaml("");
      setForceApplyValidated(false);
      setApplyConflict(false);
      setPreRefreshYaml("");
      setApplyMessage(forceApplyValidated ? "Applied successfully with force ownership." : "Applied successfully.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to apply YAML";
      const conflict = isApplyConflictError(err, message);
      if (conflict) {
        setValidatedYaml("");
        setForceApplyValidated(false);
      }
      setApplyConflict(conflict);
      setApplyMessage(conflict ? `${message}\n\nThe resource changed or Kubernetes rejected field ownership since the last dry run. Refresh YAML or run a force dry run before applying again.` : message);
    } finally {
      setApplyState("idle");
    }
  }

  async function refreshYamlFromServer() {
    setApplyState("dry-running");
    setApplyMessage("");
    try {
      const previousEdit = hasYamlChanges ? editedYaml : "";
      const nextDetail = discoveredResource
        ? await api.gvrResourceDetail(clusterId, discoveredResource, item.namespace ?? "", item.name)
        : await api.resourceDetail(clusterId, activeResource.id, item.namespace ?? "", item.name);
      onApplied(nextDetail);
      setValidatedYaml("");
      setForceApplyValidated(false);
      setApplyConflict(false);
      setEditMode(false);
      setPreRefreshYaml(previousEdit);
      setApplyMessage(previousEdit ? "Refreshed latest YAML from the cluster. Your pre-refresh edits are available to restore." : "Refreshed latest YAML from the cluster.");
    } catch (err) {
      setApplyMessage(err instanceof Error ? err.message : "Failed to refresh YAML");
    } finally {
      setApplyState("idle");
    }
  }

  function restorePreRefreshYaml() {
    if (!preRefreshYaml) return;
    setEditedYaml(preRefreshYaml);
    setValidatedYaml("");
    setForceApplyValidated(false);
    setApplyConflict(false);
    setPreRefreshYaml("");
    setEditMode(true);
    setView("yaml");
    setYamlDialogOpen(true);
    setApplyMessage("Restored your pre-refresh edits. Run a new dry run before applying.");
  }

  async function revealSecretKey(key: string) {
    if (!item.namespace) return;
    setRevealingSecretKey(key);
    setSecretError("");
    try {
      const secret = await api.revealSecretKey(clusterId, item.namespace, item.name, key);
      setRevealedSecrets((current) => ({ ...current, [key]: secret }));
    } catch (err) {
      setSecretError(err instanceof Error ? err.message : "Failed to reveal secret key");
    } finally {
      setRevealingSecretKey("");
    }
  }

  function hideSecretKey(key: string) {
    setRevealedSecrets((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function scaleResource() {
    if (!canScale || !replicas.trim()) return;
    const nextReplicas = Number(replicas);
    if (!Number.isInteger(nextReplicas) || nextReplicas < 0) {
      setActionMessage("Replicas must be a whole number greater than or equal to 0.");
      return;
    }
    setActionState("scaling");
    setActionMessage("");
    try {
      await (discoveredResource
        ? api.scaleGVRResource(clusterId, discoveredResource, item.namespace ?? "", item.name, nextReplicas)
        : api.scaleResource(clusterId, activeResource.id, item.namespace ?? "", item.name, nextReplicas));
      const nextDetail = discoveredResource
        ? await api.gvrResourceDetail(clusterId, discoveredResource, item.namespace ?? "", item.name)
        : await api.resourceDetail(clusterId, activeResource.id, item.namespace ?? "", item.name);
      onApplied(nextDetail);
      setActionMessage(`Scaled to ${nextReplicas} replica${nextReplicas === 1 ? "" : "s"}.`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Failed to scale resource");
    } finally {
      setActionState("idle");
    }
  }

  async function rollbackToRevision(revision: number) {
    if (!item.namespace) return;
    setActionState("rolling-back");
    setRollbackRevision(revision);
    setActionMessage("");
    try {
      await api.rollbackResource(clusterId, activeResource.id, item.namespace, item.name, revision);
      const nextDetail = discoveredResource
        ? await api.gvrResourceDetail(clusterId, discoveredResource, item.namespace, item.name)
        : await api.resourceDetail(clusterId, activeResource.id, item.namespace, item.name);
      onApplied(nextDetail);
      setActionMessage(`Rolled back to revision ${revision}.`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Failed to roll back");
    } finally {
      setActionState("idle");
      setRollbackRevision(null);
    }
  }

  async function deleteResource() {
    if (!canDelete || deleteConfirm !== item.name) return;
    setActionState("deleting");
    setActionMessage("");
    try {
      if (discoveredResource) {
        await api.deleteGVRResource(clusterId, discoveredResource, item.namespace ?? "", item.name);
      } else {
        await api.deleteResource(clusterId, activeResource.id, item.namespace ?? "", item.name);
      }
      onDeleted(item);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Failed to delete resource");
      setActionState("idle");
    }
  }

  async function setNodeUnschedulable(unschedulable: boolean) {
    if (activeResource.id !== "nodes" || !cleanedDetail || !canEdit) return;
    const nextDetail = JSON.parse(JSON.stringify(cleanedDetail)) as Record<string, unknown>;
    const spec = record(nextDetail.spec);
    spec.unschedulable = unschedulable;
    nextDetail.spec = spec;
    setActionState("cordoning");
    setActionMessage("");
    try {
      const nextYaml = dump(nextDetail, { lineWidth: -1, noRefs: true });
      const applied = discoveredResource
        ? await api.applyGVRResource(clusterId, discoveredResource, item.namespace ?? "", item.name, nextYaml, false)
        : await api.applyResource(clusterId, activeResource.id, item.namespace ?? "", item.name, nextYaml, false);
      onApplied(applied);
      setActionMessage(unschedulable ? "Node cordoned." : "Node uncordoned.");
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : `Failed to ${unschedulable ? "cordon" : "uncordon"} node`);
    } finally {
      setActionState("idle");
    }
  }

  async function drainNode() {
    if (activeResource.id !== "nodes" || !canEdit || drainConfirm !== item.name) return;
    setActionState("draining");
    setActionMessage("");
    try {
      const result = await api.drainNode(clusterId, item.name, {
        force: drainForce,
        deleteEmptyDirData: drainDeleteEmptyDirData
      });
      const nextDetail = discoveredResource
        ? await api.gvrResourceDetail(clusterId, discoveredResource, item.namespace ?? "", item.name)
        : await api.resourceDetail(clusterId, activeResource.id, item.namespace ?? "", item.name);
      onApplied(nextDetail);
      setActionMessage(formatNodeDrainMessage(result));
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Failed to drain node");
    } finally {
      setActionState("idle");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm">
      <aside className="h-full w-full max-w-3xl animate-slide-in-right overflow-y-auto border-l border-border bg-card shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card/95 p-5 backdrop-blur">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <FileCode2 className="h-3.5 w-3.5" />
              <span>{item.kind}</span>
              {item.namespace ? <span>{item.namespace}</span> : null}
            </div>
            <h2 className="truncate text-lg font-semibold">{item.name}</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleFavorite({ kind: item.kind, resource: activeResource.id, namespace: item.namespace, name: item.name, route: activeResource.id })}
              aria-label={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
              aria-pressed={pinned}
              title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
            >
              <Star className={cn("h-4 w-4", pinned ? "fill-yellow-400 text-yellow-400" : "")} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close resource detail">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex w-fit rounded-md bg-muted p-0.5">
            {(["summary", "events", "yaml", "json"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cn(
                  "rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  view === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setView(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
          {cleanedDetail ? (
            <section className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex items-center gap-2">
                <Scale className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Actions</h3>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {activeResource.id === "nodes" ? (
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scheduling</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {nodeUnschedulable ? "This node is cordoned and will not receive new Pods." : "This node is schedulable for new Pods."}
                    </p>
                    <Button
                      className="mt-3"
                      variant="secondary"
                      size="sm"
                      onClick={() => void setNodeUnschedulable(!nodeUnschedulable)}
                      disabled={!canEdit || actionState !== "idle"}
                      title={accessStatusMessage(updateAccess) || undefined}
                    >
                      {actionState === "cordoning" ? "Updating..." : nodeUnschedulable ? "Uncordon" : "Cordon"}
                    </Button>
                  </div>
                ) : null}
                {activeResource.id === "nodes" ? (
                  <div className="rounded-md border border-border bg-card p-3">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor={`drain-${item.name}`}>
                      Drain
                    </label>
                    <p className="mt-1 text-xs text-muted-foreground">Cordons the node and evicts eligible Pods. DaemonSet and static Pods are skipped.</p>
                    <div className="mt-2 space-y-2">
                      <label className="flex items-start gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={drainForce}
                          onChange={(event) => setDrainForce(event.target.checked)}
                          disabled={!canEdit || actionState !== "idle"}
                          className="mt-0.5 rounded border-border text-primary focus:ring-ring"
                        />
                        Evict unmanaged Pods
                      </label>
                      <label className="flex items-start gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={drainDeleteEmptyDirData}
                          onChange={(event) => setDrainDeleteEmptyDirData(event.target.checked)}
                          disabled={!canEdit || actionState !== "idle"}
                          className="mt-0.5 rounded border-border text-primary focus:ring-ring"
                        />
                        Allow emptyDir data deletion
                      </label>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        id={`drain-${item.name}`}
                        value={drainConfirm}
                        onChange={(event) => setDrainConfirm(event.target.value)}
                        placeholder={item.name}
                        disabled={!canEdit || actionState !== "idle"}
                        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void drainNode()}
                        disabled={!canEdit || actionState !== "idle" || drainConfirm !== item.name}
                        title={accessStatusMessage(updateAccess) || undefined}
                      >
                        {actionState === "draining" ? "Draining..." : "Drain"}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {activeResource.id === "services" && item.namespace ? (
	                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Port-forward</div>
                    <p className="mt-1 text-xs text-muted-foreground">Forward a Service port through one of its backing Pods.</p>
                    <Button
                      className="mt-3"
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/clusters/${clusterId}/services/${encodeURIComponent(item.namespace ?? "")}/${encodeURIComponent(item.name)}/port-forward`)}
                    >
                      <Plug className="h-3.5 w-3.5" />
                      Forward
                    </Button>
                  </div>
                ) : null}
                {scalable ? (
                  <div className="rounded-md border border-border bg-card p-3">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor={`replicas-${item.name}`}>
                      Replicas
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        id={`replicas-${item.name}`}
                        type="number"
                        min={0}
                        step={1}
                        value={replicas}
                        onChange={(event) => setReplicas(event.target.value)}
                        disabled={!canScale}
                        className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                      <Button
                        size="sm"
                        onClick={() => void scaleResource()}
                        disabled={actionState !== "idle" || !replicas.trim() || !canScale}
                        title={accessStatusMessage(scaleAccess) || undefined}
                      >
                        {actionState === "scaling" ? "Scaling..." : "Scale"}
                      </Button>
                    </div>
                    {accessDeniedMessage(scaleAccess) ? <p className="mt-2 text-xs text-destructive">{accessDeniedMessage(scaleAccess)}</p> : null}
                    {activeResource.id === "replicasets" ? (
                      <p className="mt-2 text-xs text-muted-foreground">Deployment-owned ReplicaSets may be reconciled by their owner.</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
                    Scale is available for Deployments, StatefulSets, and ReplicaSets.
                  </div>
                )}
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <label className="text-xs font-medium uppercase tracking-wide text-destructive" htmlFor={`delete-${item.name}`}>
                    Delete
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">Type the resource name to confirm deletion.</p>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      id={`delete-${item.name}`}
                      value={deleteConfirm}
                      onChange={(event) => setDeleteConfirm(event.target.value)}
                      placeholder={item.name}
                      disabled={!canDelete}
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void deleteResource()}
                      disabled={actionState !== "idle" || deleteConfirm !== item.name || !canDelete}
                      title={accessStatusMessage(deleteAccess) || undefined}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {actionState === "deleting" ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                  {accessDeniedMessage(deleteAccess) ? <p className="mt-2 text-xs text-destructive">{accessDeniedMessage(deleteAccess)}</p> : null}
                </div>
              </div>
              {actionMessage ? (
                <div
                  className={cn(
                    "mt-3 rounded-md border p-3 text-sm",
	                    isPositiveActionMessage(actionMessage)
	                      ? "border-status-success/35 bg-status-success/10 text-status-success"
	                      : "border-destructive/35 bg-destructive/10 text-destructive"
	                  )}
	                >
                  {actionMessage}
                </div>
              ) : null}
            </section>
          ) : null}
          {view === "yaml" && cleanedDetail ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
              <div className="text-sm text-muted-foreground">
                {editHint}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setYamlDialogOpen(true)}>
                  Open YAML
                </Button>
                {canEdit ? (
                  <>
	                  {editMode ? (
	                    <>
	                      <Button variant="ghost" size="sm" onClick={resetEditedYaml} disabled={applyState !== "idle"}>
	                        Reset
	                      </Button>
	                      <Button
	                        variant="secondary"
	                        size="sm"
	                        onClick={() => void validateYaml()}
	                        disabled={applyState !== "idle" || !hasYamlChanges || Boolean(yamlValidationError)}
	                      >
	                        {applyState === "dry-running" ? "Validating..." : "Dry run"}
	                      </Button>
	                      {applyConflict ? (
	                        <Button
	                          variant="secondary"
	                          size="sm"
	                          onClick={() => void validateYaml(true)}
	                          disabled={applyState !== "idle" || !hasYamlChanges || Boolean(yamlValidationError)}
	                        >
	                          Force dry run
	                        </Button>
	                      ) : null}
	                      <Button
	                        size="sm"
	                        onClick={() => void applyValidatedYaml()}
	                        disabled={applyState !== "idle" || !canApplyValidatedYaml}
	                      >
	                        {applyState === "applying" ? "Applying..." : forceApplyValidated ? "Force apply" : "Apply"}
	                      </Button>
	                    </>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => setEditMode(true)} disabled={!canEdit} title={accessStatusMessage(updateAccess) || undefined}>
                      Edit YAML
                    </Button>
                  )}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
	          {applyMessage ? (
            <div
              className={cn(
                    "whitespace-pre-line rounded-lg border p-3 text-sm",
	                isPositiveApplyMessage(applyMessage)
	                  ? "border-status-success/35 bg-status-success/10 text-status-success"
	                  : "border-destructive/35 bg-destructive/10 text-destructive"
              )}
            >
              {applyMessage}
              {applyConflict || preRefreshYaml ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {preRefreshYaml ? (
                    <Button variant="secondary" size="sm" onClick={restorePreRefreshYaml} disabled={applyState !== "idle"}>
                      Restore pre-refresh edits
                    </Button>
                  ) : null}
                  {applyConflict ? (
                  <Button variant="secondary" size="sm" onClick={() => void refreshYamlFromServer()} disabled={applyState !== "idle"}>
                    Refresh YAML
                  </Button>
                  ) : null}
                </div>
              ) : null}
	            </div>
	          ) : null}
	          {editMode && canEdit && yamlValidationError ? (
	            <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
	              {yamlValidationError}
	            </div>
	          ) : null}
          {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          {secretError ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{secretError}</div> : null}
          {!detail && !error ? <div className="shimmer h-48 rounded-lg bg-muted" /> : null}
          {cleanedDetail && view === "summary" ? (
            <>
              {activeResource.id === "nodes" ? <MetricSummary title="Node metrics" metric={nodeMetric} unavailable={nodeMetricError} /> : null}
              {activeResource.id === "services" && item.namespace ? (
                <ServicePortsSection
                  detail={cleanedDetail}
                  onForward={(port) =>
                    navigate(
                      `/clusters/${clusterId}/services/${encodeURIComponent(item.namespace ?? "")}/${encodeURIComponent(item.name)}/port-forward?port=${port}`
                    )
                  }
                />
              ) : null}
	              <ResourceSummary
	                detail={cleanedDetail}
	                activeResource={activeResource}
	                discoveredResource={discoveredResource}
	                ownedPods={ownedPods}
                ownedPodsLoading={ownedPodsLoading}
                ownedPodsError={ownedPodsError}
                ownedJobs={ownedJobs}
                ownedJobsLoading={ownedJobsLoading}
                ownedJobsError={ownedJobsError}
                revisionHistory={revisionHistory}
                revisionHistoryLoading={revisionHistoryLoading}
                revisionHistoryError={revisionHistoryError}
                onRollback={canEdit && supportsRevisionHistory(text(cleanedDetail?.kind ?? "")) ? rollbackToRevision : undefined}
                rollbackingRevision={rollbackRevision}
                openApiDoc={openApiDoc}
                serviceEndpoints={serviceEndpoints}
                serviceEndpointsLoading={serviceEndpointsLoading}
                serviceEndpointsError={serviceEndpointsError}
                serviceEndpointSlices={serviceEndpointSlices}
                serviceEndpointSlicesLoading={serviceEndpointSlicesLoading}
                serviceEndpointSlicesError={serviceEndpointSlicesError}
                namespaceQuotas={namespaceQuotas}
                namespaceQuotasLoading={namespaceQuotasLoading}
                namespaceQuotasError={namespaceQuotasError}
                namespaceLimitRanges={namespaceLimitRanges}
                namespaceLimitRangesLoading={namespaceLimitRangesLoading}
                namespaceLimitRangesError={namespaceLimitRangesError}
                nodePods={nodePods}
                nodePodsLoading={nodePodsLoading}
                nodePodsError={nodePodsError}
                secretState={
                  canEdit
                    ? undefined
                    : {
                        revealed: revealedSecrets,
                        revealingKey: revealingSecretKey,
                        onReveal: (key) => void revealSecretKey(key),
                        onHide: hideSecretKey
                      }
                }
              />
            </>
          ) : null}
          {cleanedDetail && view === "events" ? (
            <ObjectEventsPanel events={objectEvents} loading={eventsLoading} error={eventsError} onRefresh={() => void loadObjectEvents()} />
          ) : null}
	          {cleanedDetail && view === "yaml" ? (
	            editMode && canEdit ? (
	              <div className="space-y-4">
	                <Suspense fallback={<div className="shimmer min-h-96 rounded-lg bg-muted" />}>
	                  <YamlEditor
	                    value={editedYaml}
	                    onChange={updateEditedYaml}
	                    kind={item.kind || activeResource.label}
	                    apiVersion={item.apiVersion || activeResource.apiVersion}
	                    openApiDoc={openApiDoc}
	                  />
	                </Suspense>
	                <ResourceDiff rows={diffRows} unchanged={!hasYamlChanges} validated={canApplyValidatedYaml} />
	              </div>
	            ) : (
              <CodeBlock code={yaml} language="yaml" title={`${item.kind || "Resource"} YAML`} showLineNumbers />
            )
          ) : null}
          {cleanedDetail && view === "json" ? (
            <CodeBlock code={json} language="json" title={`${item.kind || "Resource"} JSON`} showLineNumbers />
          ) : null}
        </div>
      </aside>
      {cleanedDetail ? (
        <YamlViewDialog
          open={yamlDialogOpen}
          onClose={() => setYamlDialogOpen(false)}
          title={`${item.kind || "Resource"} YAML: ${item.name}`}
          yaml={yaml}
          editedYaml={editedYaml}
          onEditedYamlChange={updateEditedYaml}
          editMode={editMode}
          onEditModeChange={setEditMode}
          allowEdit={canEdit}
          readOnly={!canEdit}
          kind={item.kind || activeResource.label}
          apiVersion={item.apiVersion || activeResource.apiVersion}
          openApiDoc={openApiDoc}
          actions={
            canEdit && editMode ? (
              <>
                <Button variant="ghost" size="sm" onClick={resetEditedYaml} disabled={applyState !== "idle"}>
                  Reset
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void validateYaml()}
                  disabled={applyState !== "idle" || !hasYamlChanges || Boolean(yamlValidationError)}
                >
                  {applyState === "dry-running" ? "Validating..." : "Dry run"}
                </Button>
                {applyConflict ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void validateYaml(true)}
                    disabled={applyState !== "idle" || !hasYamlChanges || Boolean(yamlValidationError)}
                  >
                    Force dry run
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => void applyValidatedYaml()} disabled={applyState !== "idle" || !canApplyValidatedYaml}>
                  {applyState === "applying" ? "Applying..." : forceApplyValidated ? "Force apply" : "Apply"}
                </Button>
              </>
            ) : null
          }
          message={
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {editHint}
              </p>
              {applyMessage ? (
                <div
                  className={cn(
                    "whitespace-pre-line rounded-md border p-3 text-sm",
                    isPositiveApplyMessage(applyMessage)
                      ? "border-status-success/35 bg-status-success/10 text-status-success"
                      : "border-destructive/35 bg-destructive/10 text-destructive"
                  )}
                >
                  {applyMessage}
                  {applyConflict || preRefreshYaml ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {preRefreshYaml ? (
                        <Button variant="secondary" size="sm" onClick={restorePreRefreshYaml} disabled={applyState !== "idle"}>
                          Restore pre-refresh edits
                        </Button>
                      ) : null}
                      {applyConflict ? (
                      <Button variant="secondary" size="sm" onClick={() => void refreshYamlFromServer()} disabled={applyState !== "idle"}>
                        Refresh YAML
                      </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {editMode && canEdit && yamlValidationError ? (
                <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{yamlValidationError}</div>
              ) : null}
            </div>
          }
          childrenAfterEditor={editMode && canEdit ? <ResourceDiff rows={diffRows} unchanged={!hasYamlChanges} validated={canApplyValidatedYaml} /> : null}
        />
      ) : null}
    </div>
  );
}

type DiffViewMode = "split" | "unified";

function ObjectEventsPanel({
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
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Events</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Kubernetes events related to this object.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>
      {error ? <div className="m-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Message</th>
              <th className="px-4 py-3 font-medium">Age</th>
              <th className="px-4 py-3 font-medium">Count</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={`${event.namespace ?? "_cluster"}/${event.name}`} className="border-t border-border">
                <td className="px-4 py-3">
                  <StatusBadge status={event.type === "Warning" ? "warning" : "reachable"} label={event.type || "Normal"} pulse={false} />
                </td>
                <td className="px-4 py-3 font-medium text-foreground">{event.reason || "-"}</td>
                <td className="max-w-md px-4 py-3 text-muted-foreground">{event.note || event.action || "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{event.age || formatAge(event.lastTimestamp || event.eventTime) || "-"}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{event.count}</td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-muted-foreground" colSpan={5}>
                  {loading ? "Loading events..." : "No events found for this object."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResourceDiff({ rows, unchanged, validated }: { rows: DiffRow[]; unchanged: boolean; validated: boolean }) {
  const [mode, setMode] = useState<DiffViewMode>("split");
  const splitRows = useMemo(() => buildSplitDiff(rows), [rows]);

  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Dry-run diff</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Run a dry run before applying. The final Apply button is enabled only for the validated YAML.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!unchanged ? (
            <div className="flex rounded-md bg-muted p-0.5">
              {(["split", "unified"] as const).map((nextMode) => (
                <button
                  key={nextMode}
                  type="button"
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    mode === nextMode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setMode(nextMode)}
                >
                  {nextMode}
                </button>
              ))}
            </div>
          ) : null}
          {validated ? (
            <span className="rounded-md bg-status-success/10 px-2 py-1 text-xs font-medium text-status-success">Validated</span>
          ) : null}
        </div>
      </div>
      {unchanged ? (
        <div className="p-4 text-sm text-muted-foreground">No YAML changes.</div>
      ) : mode === "split" ? (
        <div className="max-h-96 overflow-auto">
          <div className="grid min-w-[44rem] grid-cols-2 border-b border-border bg-muted/50 text-xs font-medium uppercase text-muted-foreground">
            <div className="border-r border-border px-3 py-2">Original</div>
            <div className="px-3 py-2">Edited</div>
          </div>
          <pre className="font-mono text-xs leading-5">
            {splitRows.map((row, index) => (
              <div key={`${index}-${row.before}-${row.after}`} className="grid min-w-[44rem] grid-cols-2 border-b border-border/40">
                <span
                  className={cn(
                    "min-w-0 whitespace-pre-wrap break-words border-r border-border/60 px-3 py-0.5",
                    row.beforeType === "remove" ? "bg-destructive/10 text-destructive" : "text-muted-foreground"
                  )}
                >
                  {row.before || " "}
                </span>
                <span
                  className={cn(
                    "min-w-0 whitespace-pre-wrap break-words px-3 py-0.5",
                    row.afterType === "add" ? "bg-status-success/10 text-status-success" : "text-muted-foreground"
                  )}
                >
                  {row.after || " "}
                </span>
              </div>
            ))}
          </pre>
        </div>
      ) : (
        <pre className="max-h-96 overflow-auto p-0 font-mono text-xs leading-5">
          {rows.map((row, index) => (
            <div
              key={`${row.type}-${index}-${row.line}`}
              className={cn(
                "grid grid-cols-[2rem_1fr] gap-3 border-b border-border/40 px-3 py-0.5",
                row.type === "add" && "bg-status-success/10 text-status-success",
                row.type === "remove" && "bg-destructive/10 text-destructive",
                row.type === "same" && "text-muted-foreground"
              )}
            >
              <span>{row.type === "add" ? "+" : row.type === "remove" ? "-" : " "}</span>
              <span className="whitespace-pre-wrap break-words">{row.line || " "}</span>
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}

function ResourceSummary({
  detail,
  activeResource,
  discoveredResource,
  ownedPods,
  ownedPodsLoading,
  ownedPodsError,
  ownedJobs,
  ownedJobsLoading,
  ownedJobsError,
  revisionHistory,
  revisionHistoryLoading,
  revisionHistoryError,
  serviceEndpoints,
  serviceEndpointsLoading,
  serviceEndpointsError,
  serviceEndpointSlices,
  serviceEndpointSlicesLoading,
  serviceEndpointSlicesError,
  namespaceQuotas,
  namespaceQuotasLoading,
  namespaceQuotasError,
  namespaceLimitRanges,
  namespaceLimitRangesLoading,
  namespaceLimitRangesError,
  nodePods,
  nodePodsLoading,
  nodePodsError,
  secretState,
  onRollback,
  rollbackingRevision,
  openApiDoc
}: {
  detail: Record<string, unknown>;
  activeResource: ActiveResource;
  discoveredResource?: DiscoveredResource;
  openApiDoc?: OpenAPIDocument | null;
  ownedPods: K8sResourceRow[];
  ownedPodsLoading: boolean;
  ownedPodsError: string;
  ownedJobs: K8sResourceRow[];
  ownedJobsLoading: boolean;
  ownedJobsError: string;
  revisionHistory: RevisionRow[];
  revisionHistoryLoading: boolean;
  revisionHistoryError: string;
  onRollback?: (revision: number) => void;
  rollbackingRevision?: number | null;
  serviceEndpoints: ServiceEndpointRow[];
  serviceEndpointsLoading: boolean;
  serviceEndpointsError: string;
  serviceEndpointSlices: ServiceEndpointRow[];
  serviceEndpointSlicesLoading: boolean;
  serviceEndpointSlicesError: string;
  namespaceQuotas: Record<string, unknown>[];
  namespaceQuotasLoading: boolean;
  namespaceQuotasError: string;
  namespaceLimitRanges: Record<string, unknown>[];
  namespaceLimitRangesLoading: boolean;
  namespaceLimitRangesError: string;
  nodePods: K8sResourceRow[];
  nodePodsLoading: boolean;
  nodePodsError: string;
  secretState?: {
    revealed: Record<string, SecretReveal>;
    revealingKey: string;
    onReveal: (key: string) => void;
    onHide: (key: string) => void;
  };
}) {
  const metadata = record(detail.metadata);
  const labels = stringRecord(metadata.labels);
  const annotations = stringRecord(metadata.annotations);
  const ownerRefs = Array.isArray(metadata.ownerReferences) ? metadata.ownerReferences : [];
  const status = record(detail.status);
  const showWorkloadDetails = isWorkloadResource(activeResource.id, text(detail.kind));
  const showCustomResourceDetails = discoveredResource !== undefined && !isConfiguredResource(discoveredResource);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-lg border border-border bg-background p-4 text-sm sm:grid-cols-2">
        <SummaryField label="Kind" value={text(detail.kind)} />
        <SummaryField label="API Version" value={text(detail.apiVersion)} />
        <SummaryField label="Namespace" value={text(metadata.namespace) || "-"} />
        <SummaryField label="Created" value={text(metadata.creationTimestamp) || "-"} />
        <SummaryField label="UID" value={text(metadata.uid)} className="sm:col-span-2" />
        <SummaryField label="Resource Version" value={text(metadata.resourceVersion)} />
        <SummaryField label="Generation" value={text(metadata.generation)} />
      </section>

      {Object.keys(status).length > 0 ? (
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Status</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {Object.entries(status).slice(0, 8).map(([key, value]) => (
              <SummaryField
                key={key}
                label={key}
                value={summaryValue(value)}
                description={openApiDoc ? lookupFieldDoc(openApiDoc, text(detail.kind), text(detail.apiVersion), `status.${key}`) : undefined}
              />
            ))}
          </dl>
        </section>
      ) : null}

      {showWorkloadDetails ? (
        <WorkloadDetailsSection
          detail={detail}
          ownedPods={ownedPods}
          ownedPodsLoading={ownedPodsLoading}
          ownedPodsError={ownedPodsError}
          ownedJobs={ownedJobs}
          ownedJobsLoading={ownedJobsLoading}
          ownedJobsError={ownedJobsError}
          revisionHistory={revisionHistory}
          revisionHistoryLoading={revisionHistoryLoading}
          revisionHistoryError={revisionHistoryError}
          onRollback={onRollback}
          rollbackingRevision={rollbackingRevision ?? null}
        />
      ) : null}

      {showCustomResourceDetails ? <CustomResourceDetailsSection detail={detail} resource={discoveredResource} /> : null}

      {secretState ? (
        <SecretDataSection detail={detail} secretState={secretState} />
      ) : null}

      <ResourceSpecificSections
        detail={detail}
        activeResource={activeResource}
        serviceEndpoints={serviceEndpoints}
        serviceEndpointsLoading={serviceEndpointsLoading}
        serviceEndpointsError={serviceEndpointsError}
        serviceEndpointSlices={serviceEndpointSlices}
        serviceEndpointSlicesLoading={serviceEndpointSlicesLoading}
        serviceEndpointSlicesError={serviceEndpointSlicesError}
        namespaceQuotas={namespaceQuotas}
        namespaceQuotasLoading={namespaceQuotasLoading}
        namespaceQuotasError={namespaceQuotasError}
        namespaceLimitRanges={namespaceLimitRanges}
        namespaceLimitRangesLoading={namespaceLimitRangesLoading}
        namespaceLimitRangesError={namespaceLimitRangesError}
        nodePods={nodePods}
        nodePodsLoading={nodePodsLoading}
        nodePodsError={nodePodsError}
      />

      <MetadataMap title="Labels" values={labels} empty="No labels" />
      <MetadataMap title="Annotations" values={annotations} empty="No annotations" />

      {ownerRefs.length > 0 ? (
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Owners</h3>
          <div className="space-y-2">
            {ownerRefs.map((owner, index) => {
              const ownerRecord = record(owner);
              return (
                <div key={`${text(ownerRecord.kind)}-${text(ownerRecord.name)}-${index}`} className="rounded-md bg-muted px-3 py-2">
                  <div className="font-mono text-xs text-foreground">{text(ownerRecord.name) || "Unknown"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{text(ownerRecord.kind) || "Owner"}</div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
