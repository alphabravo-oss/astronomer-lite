import { dump, load, YAMLException } from "js-yaml";
import { ArrowDownUp, Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, FileCode2, Plug, Plus, RefreshCcw, Scale, Search, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MetricSummary } from "../components/metrics/metric-summary";
import { Button } from "../components/ui/button";
import { CodeBlock } from "../components/ui/code-block";
import { StatusBadge } from "../components/ui/status-badge";
import { YamlViewDialog } from "../components/ui/yaml-view-dialog";
import { useWatch } from "../hooks/use-watch";
import type {
  AccessReviewRequest,
  AccessReviewResponse,
  ApplyResponse,
  ClusterEvent,
  DiscoveredResource,
  GVRDescriptor,
  K8sResourceRow,
  MetricsRow,
  NodeDrainResponse,
  SecretReveal,
  WatchFrame
} from "../lib/api";
import { ApiError, api } from "../lib/api";
import { lookupFieldDoc, useOpenAPIDoc, type OpenAPIDocument } from "../lib/openapi";
import { resourceByRoute, resourceConfigs } from "../lib/resources";
import { cn } from "../lib/utils";

const YamlEditor = lazy(() => import("../components/ui/yaml-editor").then((module) => ({ default: module.YamlEditor })));

type SortKey = "name" | "namespace" | "kind" | "status" | "age";
type SortDirection = "asc" | "desc";
const resourcePageSizeOptions = [25, 50, 100] as const;
const resourcePageSizeStorageKey = "astronomer-lite-resource-page-size";

type ResourceListPageProps = {
  resourceId?: string;
  discoveredResource?: DiscoveredResource;
  selectedNamespaces: string[];
  refreshSignal?: number;
};

type ActiveResource = {
  id: string;
  label: string;
  namespaced: boolean;
  apiVersion: string;
  watchDescriptor: GVRDescriptor;
};

type ServiceEndpointRow = {
  name: string;
  addresses: string[];
  ports: string[];
  addressType?: string;
  age: string;
};

type AccessCheck = {
  checking: boolean;
  response: AccessReviewResponse | null;
  error: string;
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
  const [createAccess, setCreateAccess] = useState<AccessCheck>({ checking: false, response: null, error: "" });

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
      setCreateAccess({ checking: false, response: null, error: "" });
      return;
    }
    let cancelled = false;
    setCreateAccess({ checking: true, response: null, error: "" });
    void api
      .canI(clusterId, accessReviewForResource(activeResource.watchDescriptor, "create", activeResource.namespaced ? selectedNamespaces[0] || "default" : undefined))
      .then((response) => {
        if (!cancelled) setCreateAccess({ checking: false, response, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setCreateAccess({ checking: false, response: null, error: err instanceof Error ? err.message : "Authorization check unavailable" });
        }
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
        if (frame.type === "DELETED") {
          return current.filter((item) => resourceRowKey(item) !== rowKey);
        }
        const next = current.filter((item) => resourceRowKey(item) !== rowKey);
        next.push(row);
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
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{activeResource.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeResource.apiVersion ? <span className="mr-2 font-mono text-xs">{activeResource.apiVersion}/{activeResource.id}</span> : null}
            {activeResource.namespaced && selectedNamespaces.length > 0
              ? `Filtered to ${selectedNamespaces.join(", ")}.`
              : activeResource.namespaced
                ? "All namespaces in the active cluster."
                : "Cluster-scoped Kubernetes resources."}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

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
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
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
              <tr key={`${item.namespace ?? "_cluster"}/${item.name}`} className="table-row-hover border-t border-border" onClick={() => setSelected(item)}>
                <td className="px-4 py-3 font-mono text-xs font-medium">{item.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.namespace || "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.kind || activeResource.label}</td>
                <td className="px-4 py-3">
                  {item.status ? <StatusBadge status={item.status} label={item.status} /> : <span className="text-muted-foreground">-</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{item.age}</td>
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
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  direction,
  onSort
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th className="px-4 py-3 font-medium">
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(sortKey)}>
        {label}
        <ArrowDownUp className={cn("h-3 w-3", active === sortKey && direction === "desc" && "rotate-180")} />
      </button>
    </th>
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
  const [updateAccess, setUpdateAccess] = useState<AccessCheck>({ checking: false, response: null, error: "" });
  const [deleteAccess, setDeleteAccess] = useState<AccessCheck>({ checking: false, response: null, error: "" });
  const [scaleAccess, setScaleAccess] = useState<AccessCheck>({ checking: false, response: null, error: "" });
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
    setUpdateAccess({ checking: true, response: null, error: "" });
    setDeleteAccess({ checking: true, response: null, error: "" });
    setScaleAccess(scaleRequest ? { checking: true, response: null, error: "" } : { checking: false, response: null, error: "" });
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
      setApplyConflict(isApplyConflictMessage(message));
      setApplyMessage(isApplyConflictMessage(message) ? `${message}\n\nKubernetes reported a server-side apply conflict. Force apply can take ownership of the conflicting fields after a successful force dry run.` : message);
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
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close resource detail">
            <X className="h-4 w-4" />
          </Button>
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
	                  <YamlEditor value={editedYaml} onChange={updateEditedYaml} />
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

type DiffRow = {
  type: "same" | "add" | "remove";
  line: string;
};

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
                <td className="px-4 py-3 text-muted-foreground">{event.age || formatEventTimestamp(event.lastTimestamp || event.eventTime)}</td>
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

function formatEventTimestamp(value: string) {
  if (!value) return "-";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function createTemplate(resource: ActiveResource, preferredNamespace?: string) {
  const apiVersion = resource.apiVersion || "v1";
  const kind = defaultKindForResource(resource.id, resource.watchDescriptor.kind || resource.label);
  const namespace = resource.namespaced ? `\n  namespace: ${preferredNamespace || "default"}` : "";
  return `apiVersion: ${apiVersion}
kind: ${kind}
metadata:
  name: example-${resource.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}${namespace}
`;
}

function defaultKindForResource(id: string, label: string) {
  const known: Record<string, string> = {
    nodes: "Node",
    namespaces: "Namespace",
    deployments: "Deployment",
    replicasets: "ReplicaSet",
    daemonsets: "DaemonSet",
    statefulsets: "StatefulSet",
    jobs: "Job",
    cronjobs: "CronJob",
    pods: "Pod",
    services: "Service",
    endpoints: "Endpoints",
    ingresses: "Ingress",
    ingressclasses: "IngressClass",
    persistentvolumes: "PersistentVolume",
    persistentvolumeclaims: "PersistentVolumeClaim",
    storageclasses: "StorageClass",
    configmaps: "ConfigMap",
    secrets: "Secret",
    networkpolicies: "NetworkPolicy",
    horizontalpodautoscalers: "HorizontalPodAutoscaler",
    poddisruptionbudgets: "PodDisruptionBudget",
    serviceaccounts: "ServiceAccount",
    roles: "Role",
    rolebindings: "RoleBinding",
    clusterroles: "ClusterRole",
    clusterrolebindings: "ClusterRoleBinding",
    resourcequotas: "ResourceQuota",
    limitranges: "LimitRange",
    leases: "Lease",
    backendtlspolicies: "BackendTLSPolicy",
    xbackendtrafficpolicies: "XBackendTrafficPolicy",
    priorityclasses: "PriorityClass",
    runtimeclasses: "RuntimeClass",
    mutatingwebhookconfigurations: "MutatingWebhookConfiguration",
    validatingwebhookconfigurations: "ValidatingWebhookConfiguration",
    crds: "CustomResourceDefinition"
  };
  if (known[id]) return known[id];
  return label.endsWith("s") ? label.slice(0, -1) : label;
}

function accessReviewForResource(gvr: GVRDescriptor, verb: string, namespace?: string, name?: string, subresource?: string): AccessReviewRequest {
  return {
    verb,
    group: gvr.group,
    resource: gvr.resource,
    namespace,
    name,
    subresource
  };
}

function accessCheckFromSettled(result: PromiseSettledResult<AccessReviewResponse | null>): AccessCheck {
  if (result.status === "fulfilled") {
    return { checking: false, response: result.value, error: "" };
  }
  return {
    checking: false,
    response: null,
    error: result.reason instanceof Error ? result.reason.message : "Authorization check unavailable"
  };
}

function isAccessDenied(check: AccessCheck) {
  return check.response?.allowed === false || check.response?.denied === true;
}

function isAccessBlocked(check: AccessCheck) {
  return check.checking || isAccessDenied(check);
}

function accessDeniedMessage(check: AccessCheck) {
  if (!isAccessDenied(check)) return "";
  return check.response?.reason || "Not allowed by Kubernetes RBAC.";
}

function accessStatusMessage(check: AccessCheck) {
  if (check.checking) return "Checking Kubernetes authorization...";
  return accessDeniedMessage(check) || (check.error ? `Authorization check unavailable: ${check.error}` : "");
}

function resourceUnavailableMessage(resource: ActiveResource) {
  const group = resource.watchDescriptor.group || "core";
  return `This cluster does not serve ${group}/${resource.watchDescriptor.version}/${resource.watchDescriptor.resource}. Open API Resources to browse the resources discovered on this cluster.`;
}

function isConfiguredResource(resource: DiscoveredResource) {
  return resourceConfigs.some(
    (config) =>
      config.apiGroup === resource.group &&
      config.version === resource.version &&
      config.resource === resource.resource
  );
}

function formatNodeDrainMessage(result: NodeDrainResponse) {
  const parts = [`Node drained: ${result.evicted.length} evicted`];
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);
  if (result.errors.length > 0) {
    const firstError = result.errors[0];
    parts.push(`${result.errors.length} failed`);
    parts.push(`${firstError.namespace}/${firstError.name}: ${firstError.error || "eviction failed"}`);
  }
  if (result.evicted.length === 0 && result.skipped.length === 0 && result.errors.length === 0) {
    parts.push("no Pods were running on the node");
  }
  return parts.join(". ");
}

function isPositiveActionMessage(message: string) {
  if (!message) return false;
  if (message.includes("failed") || message.includes("Failed")) return false;
  return message.startsWith("Scaled") || message.startsWith("Node cordoned") || message.startsWith("Node uncordoned") || message.startsWith("Node drained");
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

type SplitDiffRow = {
  before: string;
  after: string;
  beforeType: "same" | "remove" | "blank";
  afterType: "same" | "add" | "blank";
};

function buildSplitDiff(rows: DiffRow[]): SplitDiffRow[] {
  const result: SplitDiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (row.type === "same") {
      result.push({ before: row.line, after: row.line, beforeType: "same", afterType: "same" });
      index += 1;
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];
    while (index < rows.length && rows[index].type !== "same") {
      if (rows[index].type === "remove") removed.push(rows[index].line);
      if (rows[index].type === "add") added.push(rows[index].line);
      index += 1;
    }

    const length = Math.max(removed.length, added.length);
    for (let i = 0; i < length; i += 1) {
      result.push({
        before: removed[i] ?? "",
        after: added[i] ?? "",
        beforeType: removed[i] === undefined ? "blank" : "remove",
        afterType: added[i] === undefined ? "blank" : "add"
      });
    }
  }
  return result;
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

function ResourceSpecificSections({
  detail,
  activeResource,
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
  nodePodsError
}: {
  detail: Record<string, unknown>;
  activeResource: ActiveResource;
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
}) {
  const spec = record(detail.spec);
  const id = activeResource.id;
  const sections: ReactNode[] = [];

  if (id === "services") {
    sections.push(
      <section key="service-info" className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Service</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Type" value={text(spec.type) || "-"} />
          <SummaryField label="Cluster IP" value={text(spec.clusterIP) || "-"} />
          <SummaryField label="External IPs" value={stringList(spec.externalIPs).join(", ") || "-"} />
          <SummaryField label="External Name" value={text(spec.externalName) || "-"} />
        </dl>
        <div className="mt-4">
          <InlineMetadataMap title="Selector" values={stringRecord(spec.selector)} empty="No selector" />
        </div>
      </section>
    );
    sections.push(<ServiceEndpointsSection key="service-endpoints" rows={serviceEndpoints} loading={serviceEndpointsLoading} error={serviceEndpointsError} />);
    sections.push(
      <ServiceEndpointsSection
        key="service-endpoint-slices"
        title="Endpoint Slices"
        description="EndpointSlice addresses selected by this Service."
        rows={serviceEndpointSlices}
        loading={serviceEndpointSlicesLoading}
        error={serviceEndpointSlicesError}
      />
    );
  }

  if (id === "ingresses") {
    sections.push(<IngressDetailsSection key="ingress-details" detail={detail} />);
  }

  if (id === "persistentvolumes" || id === "persistentvolumeclaims" || id === "storageclasses") {
    sections.push(<StorageDetailsSection key="storage-details" detail={detail} resourceId={id} />);
  }

  if (id === "configmaps") {
    sections.push(<ConfigMapDataSection key="configmap-data" detail={detail} />);
  }

  if (id === "roles" || id === "clusterroles") {
    sections.push(<RoleRulesSection key="role-rules" detail={detail} />);
  }

  if (id === "rolebindings" || id === "clusterrolebindings") {
    sections.push(<RoleBindingSubjectsSection key="role-binding-subjects" detail={detail} />);
  }

  if (id === "priorityclasses") {
    sections.push(<PriorityClassDetailsSection key="priority-class-details" detail={detail} />);
  }

  if (id === "runtimeclasses") {
    sections.push(<RuntimeClassDetailsSection key="runtime-class-details" detail={detail} />);
  }

  if (id === "mutatingwebhookconfigurations" || id === "validatingwebhookconfigurations") {
    sections.push(<WebhookConfigurationDetailsSection key="webhook-configuration-details" detail={detail} resourceId={id} />);
  }

  if (id === "serviceaccounts") {
    sections.push(<ServiceAccountReferencesSection key="service-account-references" detail={detail} />);
  }

  if (id === "networkpolicies") {
    sections.push(<NetworkPolicyDetailsSection key="network-policy-details" detail={detail} />);
  }

  if (id === "horizontalpodautoscalers") {
    sections.push(<HorizontalPodAutoscalerDetailsSection key="hpa-details" detail={detail} />);
  }

  if (id === "poddisruptionbudgets") {
    sections.push(<PodDisruptionBudgetDetailsSection key="pod-disruption-budget-details" detail={detail} />);
  }

  if (id === "resourcequotas") {
    sections.push(<ResourceQuotaDetailsSection key="resource-quota-details" detail={detail} />);
  }

  if (id === "limitranges") {
    sections.push(<LimitRangeDetailsSection key="limit-range-details" detail={detail} />);
  }

  if (id === "leases") {
    sections.push(<LeaseDetailsSection key="lease-details" detail={detail} />);
  }

  if (id === "namespaces") {
    sections.push(
      <NamespaceDetailsSection
        key="namespace-details"
        detail={detail}
        quotas={namespaceQuotas}
        quotasLoading={namespaceQuotasLoading}
        quotasError={namespaceQuotasError}
        limitRanges={namespaceLimitRanges}
        limitRangesLoading={namespaceLimitRangesLoading}
        limitRangesError={namespaceLimitRangesError}
      />
    );
  }

  if (id === "nodes") {
    sections.push(<NodeDetailsSection key="node-details" detail={detail} pods={nodePods} podsLoading={nodePodsLoading} podsError={nodePodsError} />);
  }

  if (id === "endpoints") {
    sections.push(<EndpointDetailsSection key="endpoint-details" detail={detail} />);
  }

  if (id === "endpointslices") {
    sections.push(<EndpointSliceDetailsSection key="endpoint-slice-details" detail={detail} />);
  }

  if (id === "ingressclasses") {
    sections.push(<IngressClassDetailsSection key="ingress-class-details" detail={detail} />);
  }

  if (
    id === "gateways" ||
    id === "gatewayclasses" ||
    id === "httproutes" ||
    id === "grpcroutes" ||
    id === "referencegrants" ||
    id === "backendtlspolicies" ||
    id === "xbackendtrafficpolicies"
  ) {
    sections.push(<GatewayApiDetailsSection key="gateway-api-details" detail={detail} resourceId={id} />);
  }

  if (id === "crds") {
    sections.push(<CrdDetailsSection key="crd-details" detail={detail} />);
  }

  return sections.length > 0 ? <>{sections}</> : null;
}

function WorkloadDetailsSection({
  detail,
  ownedPods,
  ownedPodsLoading,
  ownedPodsError,
  ownedJobs,
  ownedJobsLoading,
  ownedJobsError,
  revisionHistory,
  revisionHistoryLoading,
  revisionHistoryError,
  onRollback,
  rollbackingRevision
}: {
  detail: Record<string, unknown>;
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
  rollbackingRevision: number | null;
}) {
  const kind = text(detail.kind);
  const spec = record(detail.spec);
  const status = record(detail.status);
  const templateSpec = record(record(spec.template).spec);
  const selector = record(spec.selector);
  const matchLabels = stringRecord(selector.matchLabels);
  const nodeSelector = stringRecord(templateSpec.nodeSelector);
  const replicas = workloadReplicaRows(kind, spec, status);
  const conditions = workloadConditionRows(status);
  const containers = workloadContainerRows(detail);
  const initContainers = workloadContainerRows(detail, "initContainers");
  const strategy = workloadStrategyValue(spec);

  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Workload</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {strategy ? <SummaryField label="Strategy" value={strategy} /> : null}
          {text(spec.serviceName) ? <SummaryField label="Service" value={text(spec.serviceName)} /> : null}
          {text(spec.schedule) ? <SummaryField label="Schedule" value={text(spec.schedule)} /> : null}
          {spec.suspend !== undefined ? <SummaryField label="Suspended" value={summaryValue(spec.suspend)} /> : null}
          {text(status.currentRevision) ? <SummaryField label="Current Revision" value={text(status.currentRevision)} /> : null}
          {text(status.updateRevision) ? <SummaryField label="Update Revision" value={text(status.updateRevision)} /> : null}
        </dl>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <InlineMetadataMap title="Selector" values={matchLabels} empty="No match labels" />
          <InlineMetadataMap title="Node Selector" values={nodeSelector} empty="No node selector" />
        </div>
      </section>

      {replicas.length > 0 ? (
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Replicas</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {replicas.map(([label, value]) => (
              <SummaryField key={label} label={label} value={value} />
            ))}
          </dl>
        </section>
      ) : null}

      {conditions.length > 0 ? <ConditionsSection rows={conditions} /> : null}
      {isOwnedPodResource(text(detail.kind).toLowerCase(), text(detail.kind)) ? <OwnedPodsSection rows={ownedPods} loading={ownedPodsLoading} error={ownedPodsError} /> : null}
      {kind === "CronJob" ? <OwnedJobsSection rows={ownedJobs} loading={ownedJobsLoading} error={ownedJobsError} /> : null}
      {containers.length > 0 ? <ContainerSpecSection title={kind === "Pod" ? "Containers" : "Container Spec"} rows={containers} /> : null}
      {initContainers.length > 0 ? <ContainerSpecSection title="Init Containers" rows={initContainers} /> : null}
      {supportsRevisionHistory(kind) ? (
        <RevisionHistorySection
          rows={revisionHistory}
          loading={revisionHistoryLoading}
          error={revisionHistoryError}
          onRollback={onRollback}
          rollbackingRevision={rollbackingRevision}
        />
      ) : null}
    </>
  );
}

type ConditionRow = {
  type: string;
  status: string;
  reason: string;
  message: string;
  age: string;
};

function ConditionsSection({ rows }: { rows: ConditionRow[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Conditions</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Age</th>
              <th className="px-4 py-3 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.type}-${row.reason}-${row.age}`} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{row.type || "-"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status === "True" ? "success" : row.status === "False" ? "warning" : "unknown"} label={row.status || "-"} pulse={false} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.reason || "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.age || "-"}</td>
                <td className="max-w-md px-4 py-3 text-muted-foreground">{row.message || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OwnedPodsSection({ rows, loading, error }: { rows: K8sResourceRow[]; loading: boolean; error: string }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Owned Pods</h3>
        <p className="mt-1 text-xs text-muted-foreground">Pods matching this workload selector.</p>
      </div>
      {error ? <div className="m-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.namespace ?? "_cluster"}/${row.name}`} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs font-medium">{row.name}</td>
                <td className="px-4 py-3">
                  {row.status ? <StatusBadge status={row.status} label={row.status} pulse={false} /> : <span className="text-muted-foreground">-</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.age || "-"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground" colSpan={3}>
                  {loading ? "Loading Pods..." : "No matching Pods found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OwnedJobsSection({ rows, loading, error }: { rows: K8sResourceRow[]; loading: boolean; error: string }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Owned Jobs</h3>
        <p className="mt-1 text-xs text-muted-foreground">Jobs created by this CronJob.</p>
      </div>
      {error ? <div className="m-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.namespace ?? "_cluster"}/${row.name}`} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs font-medium">{row.name}</td>
                <td className="px-4 py-3">
                  {row.status ? <StatusBadge status={row.status} label={row.status} pulse={false} /> : <span className="text-muted-foreground">-</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.age || "-"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground" colSpan={3}>
                  {loading ? "Loading Jobs..." : "No owned Jobs found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type RevisionRow = {
  revision: number;
  createdAt: string;
  age: string;
  images: string[];
  current: boolean;
};

function RevisionHistorySection({
  rows,
  loading,
  error,
  onRollback,
  rollbackingRevision
}: {
  rows: RevisionRow[];
  loading: boolean;
  error: string;
  onRollback?: (revision: number) => void;
  rollbackingRevision?: number | null;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Revision History</h3>
        <p className="mt-1 text-xs text-muted-foreground">Pod template revisions retained by Kubernetes.</p>
      </div>
      {error ? <div className="m-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Revision</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Images</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {onRollback ? <th className="px-4 py-3 font-medium text-right">Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.revision}-${row.createdAt}`} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs font-medium">{row.revision}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  <div>{row.age || "-"}</div>
                  {row.createdAt ? <div className="mt-1 font-mono text-[11px]">{row.createdAt}</div> : null}
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    {row.images.length > 0 ? (
                      row.images.map((image, index) => (
                        <div key={`${row.revision}-${image}-${index}`} className="font-mono text-xs text-muted-foreground">
                          {image}
                        </div>
                      ))
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.current ? "success" : "unknown"} label={row.current ? "Current" : "Previous"} pulse={false} />
                </td>
                {onRollback ? (
                  <td className="px-4 py-3 text-right">
                    {row.current ? (
                      <span className="text-xs text-muted-foreground">Current</span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onRollback(row.revision)}
                        disabled={rollbackingRevision !== null && rollbackingRevision !== undefined}
                        aria-label={`Roll back to revision ${row.revision}`}
                      >
                        {rollbackingRevision === row.revision ? "Rolling back..." : "Roll back"}
                      </Button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground" colSpan={onRollback ? 5 : 4}>
                  {loading ? "Loading revision history..." : "No revision history available."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ContainerRow = {
  name: string;
  image: string;
  pullPolicy: string;
  ports: string;
  requests: string;
  limits: string;
};

function ContainerSpecSection({ title, rows }: { title: string; rows: ContainerRow[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Image</th>
              <th className="px-4 py-3 font-medium">Pull Policy</th>
              <th className="px-4 py-3 font-medium">Ports</th>
              <th className="px-4 py-3 font-medium">Requests</th>
              <th className="px-4 py-3 font-medium">Limits</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.name}`} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs font-medium">{row.name || "-"}</td>
                <td className="max-w-xs px-4 py-3 font-mono text-xs text-muted-foreground">{row.image || "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.pullPolicy || "-"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.ports || "-"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.requests || "-"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.limits || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ServicePortRow = {
  name: string;
  protocol: string;
  port: number;
  targetPort: string;
};

function ServicePortsSection({ detail, onForward }: { detail: Record<string, unknown>; onForward: (port: number) => void }) {
  const rows = servicePortRows(detail);
  if (rows.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Ports</h3>
        <p className="mt-1 text-xs text-muted-foreground">Service ports and target ports for port-forwarding.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Protocol</th>
              <th className="px-4 py-3 font-medium">Port</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.name || "_"}-${row.protocol}-${row.port}`} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs text-foreground">{row.name || "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.protocol || "TCP"}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {row.port} <span className="text-muted-foreground">-&gt;</span> {row.targetPort || row.port}
                </td>
                <td className="px-4 py-3">
                  <Button variant="secondary" size="sm" onClick={() => onForward(row.port)}>
                    <Plug className="h-3.5 w-3.5" />
                    Forward
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function servicePortRows(detail: Record<string, unknown>): ServicePortRow[] {
  const spec = record(detail.spec);
  const ports = Array.isArray(spec.ports) ? spec.ports : [];
  return ports
    .map((item) => {
      const port = record(item);
      const portValue = Number(port.port);
      if (!Number.isFinite(portValue) || portValue <= 0) return null;
      return {
        name: text(port.name),
        protocol: text(port.protocol) || "TCP",
        port: portValue,
        targetPort: text(port.targetPort) || String(portValue)
      };
    })
    .filter((row): row is ServicePortRow => row !== null);
}

function SecretDataSection({
  detail,
  secretState
}: {
  detail: Record<string, unknown>;
  secretState: {
    revealed: Record<string, SecretReveal>;
    revealingKey: string;
    onReveal: (key: string) => void;
    onHide: (key: string) => void;
  };
}) {
  const data = stringRecord(detail.data);
  const entries = Object.keys(data).sort((a, b) => a.localeCompare(b));
  const [copiedKey, setCopiedKey] = useState("");

  async function copyValue(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(""), 1600);
  }

  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Secret Data</h3>
        <p className="mt-1 text-sm text-muted-foreground">Values stay masked until a key is revealed.</p>
      </div>
      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map((key) => {
            const revealed = secretState.revealed[key];
            const displayValue = revealed ? revealed.value ?? revealed.base64 : data[key];
            return (
              <div key={key} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium text-foreground">{key}</div>
                    {revealed?.binary ? <div className="mt-1 text-xs text-muted-foreground">Binary value shown as base64</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {revealed ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => void copyValue(key, displayValue)}>
                          {copiedKey === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedKey === key ? "Copied" : "Copy"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => secretState.onHide(key)}>
                          <EyeOff className="h-3.5 w-3.5" />
                          Hide
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => secretState.onReveal(key)}
                        disabled={secretState.revealingKey === key}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {secretState.revealingKey === key ? "Revealing..." : "Reveal"}
                      </Button>
                    )}
                  </div>
                </div>
                <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-[#0a0a0f] p-3 font-mono text-xs leading-5 text-zinc-300">
                  {displayValue}
                </pre>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No data keys</p>
      )}
    </section>
  );
}

function ServiceEndpointsSection({
  title = "Endpoints",
  description = "Endpoint addresses selected by this Service.",
  rows,
  loading,
  error
}: {
  title?: string;
  description?: string;
  rows: ServiceEndpointRow[];
  loading: boolean;
  error: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {error ? <div className="m-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Addresses</th>
              <th className="px-4 py-3 font-medium">Ports</th>
              <th className="px-4 py-3 font-medium">Address Type</th>
              <th className="px-4 py-3 font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs font-medium">{row.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.addresses.join(", ") || "-"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.ports.join(", ") || "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.addressType || "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.age || "-"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                  {loading ? `Loading ${title.toLowerCase()}...` : `No ${title.toLowerCase()} found for this Service.`}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IngressDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  const tls = Array.isArray(spec.tls) ? spec.tls.map((item) => record(item)) : [];
  const rules = ingressRuleRows(detail);
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Ingress</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Class Name" value={text(spec.ingressClassName) || "-"} />
          <SummaryField label="Default Backend" value={ingressBackendSummary(record(spec.defaultBackend)) || "-"} />
          <SummaryField label="Ports" value={ingressPorts(detail).join(", ") || "-"} />
          <SummaryField label="TLS" value={tls.map((item) => `${text(item.secretName) || "-"}: ${stringList(item.hosts).join(", ") || "-"}`).join("; ") || "-"} />
        </dl>
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Rules</h3>
        </div>
        <SimpleRowsTable
          columns={["Host", "Path", "Backend"]}
          rows={rules.map((row) => [row.host || "*", row.path || "-", row.backend || "-"])}
          empty="No rules found."
        />
      </section>
    </>
  );
}

function IngressClassDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  const metadata = record(detail.metadata);
  const annotations = record(metadata.annotations);
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Ingress Class</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <SummaryField label="Controller" value={text(spec.controller) || "-"} />
        <SummaryField label="Default" value={text(annotations["ingressclass.kubernetes.io/is-default-class"]) || "false"} />
        <SummaryField label="Parameters" value={ingressClassParametersSummary(record(spec.parameters)) || "-"} className="sm:col-span-2" />
      </dl>
    </section>
  );
}

function StorageDetailsSection({ detail, resourceId }: { detail: Record<string, unknown>; resourceId: string }) {
  const spec = record(detail.spec);
  const status = record(detail.status);
  const rows: Array<[string, string]> =
    resourceId === "storageclasses"
      ? [
          ["Provisioner", text(spec.provisioner)],
          ["Reclaim Policy", text(spec.reclaimPolicy)],
          ["Binding Mode", text(spec.volumeBindingMode)],
          ["Allow Expansion", summaryValue(spec.allowVolumeExpansion)]
        ]
      : [
          ["Status", text(status.phase)],
          ["Capacity", text(record(spec.capacity).storage) || text(record(record(spec.resources).requests).storage)],
          ["Access Modes", stringList(spec.accessModes).join(", ")],
          ["Volume Mode", text(spec.volumeMode)],
          ["Storage Class", text(spec.storageClassName)],
          ["Reclaim Policy", text(spec.persistentVolumeReclaimPolicy)],
          ["Volume Name", text(spec.volumeName)]
        ];
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Storage</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <SummaryField key={label} label={label} value={value} />
          ))}
      </dl>
    </section>
  );
}

function HorizontalPodAutoscalerDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  const status = record(detail.status);
  const scaleTarget = record(spec.scaleTargetRef);
  const metrics = arrayRecords(spec.metrics);
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Horizontal Pod Autoscaler</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Scale Target" value={[text(scaleTarget.kind), text(scaleTarget.name)].filter(Boolean).join("/") || "-"} />
          <SummaryField label="Replicas" value={[text(spec.minReplicas) || "1", text(status.currentReplicas), text(spec.maxReplicas)].filter(Boolean).join(" / ") || "-"} />
          <SummaryField label="Desired Replicas" value={text(status.desiredReplicas) || "-"} />
          <SummaryField label="Current Metrics" value={summaryValue(arrayRecords(status.currentMetrics).length)} />
        </dl>
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Metrics</h3>
        </div>
        <SimpleRowsTable
          columns={["Type", "Metric", "Target"]}
          rows={metrics.map((metric) => [text(metric.type) || "-", hpaMetricName(metric), hpaMetricTarget(metric)])}
          empty="No metric targets found."
        />
      </section>
      <ConditionsSection rows={workloadConditionRows(status)} />
    </>
  );
}

function ResourceQuotaDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  const status = record(detail.status);
  const hard = record(status.hard);
  const used = record(status.used);
  const keys = Array.from(new Set([...Object.keys(record(spec.hard)), ...Object.keys(hard), ...Object.keys(used)])).sort();
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Resource Quota</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Scopes" value={stringList(spec.scopes).join(", ") || "-"} />
          <SummaryField label="Resources" value={summaryValue(keys.length)} />
        </dl>
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Usage</h3>
        </div>
        <SimpleRowsTable
          columns={["Resource", "Used", "Hard"]}
          rows={keys.map((key) => [key, summaryValue(used[key]) || "-", summaryValue(hard[key] ?? record(spec.hard)[key]) || "-"])}
          empty="No quota resources found."
        />
      </section>
    </>
  );
}

function LimitRangeDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const limits = arrayRecords(record(detail.spec).limits);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Limit Range</h3>
      </div>
      <SimpleRowsTable
        columns={["Type", "Min", "Max", "Default", "Default Request", "Ratio"]}
        rows={limits.map((limit) => [
          text(limit.type) || "-",
          resourceMapSummary(record(limit.min)) || "-",
          resourceMapSummary(record(limit.max)) || "-",
          resourceMapSummary(record(limit.default)) || "-",
          resourceMapSummary(record(limit.defaultRequest)) || "-",
          resourceMapSummary(record(limit.maxLimitRequestRatio)) || "-"
        ])}
        empty="No limits found."
      />
    </section>
  );
}

function LeaseDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Lease</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <SummaryField label="Holder" value={text(spec.holderIdentity) || "-"} />
        <SummaryField label="Duration" value={text(spec.leaseDurationSeconds) ? `${text(spec.leaseDurationSeconds)}s` : "-"} />
        <SummaryField label="Transitions" value={text(spec.leaseTransitions) || "-"} />
        <SummaryField label="Renew Time" value={text(spec.renewTime) || "-"} />
        <SummaryField label="Acquire Time" value={text(spec.acquireTime) || "-"} />
      </dl>
    </section>
  );
}

function ConfigMapDataSection({ detail }: { detail: Record<string, unknown> }) {
  const data = stringRecord(detail.data);
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Data</h3>
      {entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-md border border-border bg-card p-3">
              <div className="mb-2 font-mono text-xs font-medium text-foreground">{key}</div>
              <pre className="max-h-44 overflow-auto rounded-md bg-[#0a0a0f] p-3 font-mono text-xs leading-5 text-zinc-300">{value}</pre>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No data keys</p>
      )}
    </section>
  );
}

function RoleRulesSection({ detail }: { detail: Record<string, unknown> }) {
  const rules = Array.isArray(detail.rules) ? detail.rules.map((item) => record(item)) : [];
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Rules</h3>
      </div>
      <SimpleRowsTable
        columns={["API Groups", "Resources", "Non Resources", "Verbs"]}
        rows={rules.map((rule) => [
          stringList(rule.apiGroups).join(", ") || "-",
          stringList(rule.resources).join(", ") || "-",
          stringList(rule.nonResourceURLs).join(", ") || "-",
          stringList(rule.verbs).join(", ") || "-"
        ])}
        empty="No rules found."
      />
    </section>
  );
}

function RoleBindingSubjectsSection({ detail }: { detail: Record<string, unknown> }) {
  const roleRef = record(detail.roleRef);
  const subjects = Array.isArray(detail.subjects) ? detail.subjects.map((item) => record(item)) : [];
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Role Reference</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <SummaryField label="Kind" value={text(roleRef.kind)} />
          <SummaryField label="Name" value={text(roleRef.name)} />
          <SummaryField label="API Group" value={text(roleRef.apiGroup)} />
        </dl>
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Subjects</h3>
        </div>
        <SimpleRowsTable
          columns={["Kind", "Name", "Namespace"]}
          rows={subjects.map((subject) => [text(subject.kind) || "-", text(subject.name) || "-", text(subject.namespace) || "-"])}
          empty="No subjects found."
        />
      </section>
    </>
  );
}

function PriorityClassDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const value = detail.value;
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Priority Class</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <SummaryField label="Value" value={summaryValue(value) || "-"} />
        <SummaryField label="Global Default" value={summaryValue(detail.globalDefault) || "false"} />
        <SummaryField label="Preemption Policy" value={text(detail.preemptionPolicy) || "-"} />
        <SummaryField label="Description" value={text(detail.description) || "-"} className="sm:col-span-2" />
      </dl>
    </section>
  );
}

function RuntimeClassDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const handler = text(detail.handler);
  const overhead = record(detail.overhead);
  const scheduling = record(detail.scheduling);
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Runtime Class</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <SummaryField label="Handler" value={handler || "-"} />
        <SummaryField label="Overhead" value={resourceMapSummary(record(overhead.podFixed)) || "-"} />
        <SummaryField label="Node Selector" value={resourceMapSummary(record(scheduling.nodeSelector)) || "-"} />
        <SummaryField label="Tolerations" value={summaryValue(arrayRecords(scheduling.tolerations).length)} />
      </dl>
    </section>
  );
}

function WebhookConfigurationDetailsSection({ detail, resourceId }: { detail: Record<string, unknown>; resourceId: string }) {
  const webhooks = arrayRecords(detail.webhooks);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{resourceId === "mutatingwebhookconfigurations" ? "Mutating Webhooks" : "Validating Webhooks"}</h3>
      </div>
      <SimpleRowsTable
        columns={["Name", "Client", "Failure Policy", "Side Effects", "Timeout", "Rules"]}
        rows={webhooks.map((webhook) => [
          text(webhook.name) || "-",
          webhookClientSummary(record(webhook.clientConfig)),
          text(webhook.failurePolicy) || "-",
          text(webhook.sideEffects) || "-",
          text(webhook.timeoutSeconds) || "-",
          summaryValue(arrayRecords(webhook.rules).length)
        ])}
        empty="No webhooks found."
      />
    </section>
  );
}

function webhookClientSummary(clientConfig: Record<string, unknown>) {
  const url = text(clientConfig.url);
  if (url) return url;
  const service = record(clientConfig.service);
  const namespace = text(service.namespace);
  const name = text(service.name);
  const path = text(service.path);
  if (!namespace && !name) return "-";
  return `${namespace || "default"}/${name || "-"}${path ? `:${path}` : ""}`;
}

function ServiceAccountReferencesSection({ detail }: { detail: Record<string, unknown> }) {
  const secrets = namedRefs(detail.secrets);
  const imagePullSecrets = namedRefs(detail.imagePullSecrets);
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Service Account</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <SummaryField label="Secrets" value={secrets.join(", ") || "-"} />
        <SummaryField label="Image Pull Secrets" value={imagePullSecrets.join(", ") || "-"} />
      </dl>
    </section>
  );
}

function NetworkPolicyDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Network Policy</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <SummaryField label="Policy Types" value={stringList(spec.policyTypes).join(", ") || "-"} />
        <SummaryField label="Ingress Rules" value={summaryValue(Array.isArray(spec.ingress) ? spec.ingress.length : 0)} />
        <SummaryField label="Egress Rules" value={summaryValue(Array.isArray(spec.egress) ? spec.egress.length : 0)} />
      </dl>
      <div className="mt-4">
        <InlineMetadataMap title="Pod Selector" values={stringRecord(record(spec.podSelector).matchLabels)} empty="Selects all Pods in the namespace" />
      </div>
    </section>
  );
}

function PodDisruptionBudgetDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  const status = record(detail.status);
  const conditions = workloadConditionRows(status);
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Pod Disruption Budget</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <SummaryField label="Min Available" value={summaryValue(spec.minAvailable) || "-"} />
        <SummaryField label="Max Unavailable" value={summaryValue(spec.maxUnavailable) || "-"} />
        <SummaryField label="Disruptions Allowed" value={summaryValue(status.disruptionsAllowed) || "-"} />
        <SummaryField label="Current Healthy" value={summaryValue(status.currentHealthy) || "-"} />
        <SummaryField label="Desired Healthy" value={summaryValue(status.desiredHealthy) || "-"} />
        <SummaryField label="Expected Pods" value={summaryValue(status.expectedPods) || "-"} />
      </dl>
      <div className="mt-4">
        <InlineMetadataMap title="Selector" values={stringRecord(record(spec.selector).matchLabels)} empty="No match labels" />
      </div>
      {conditions.length > 0 ? (
        <div className="mt-4">
          <ConditionsSection rows={conditions} />
        </div>
      ) : null}
    </section>
  );
}

function NamespaceDetailsSection({
  detail,
  quotas,
  quotasLoading,
  quotasError,
  limitRanges,
  limitRangesLoading,
  limitRangesError
}: {
  detail: Record<string, unknown>;
  quotas: Record<string, unknown>[];
  quotasLoading: boolean;
  quotasError: string;
  limitRanges: Record<string, unknown>[];
  limitRangesLoading: boolean;
  limitRangesError: string;
}) {
  const status = record(detail.status);
  const conditions = workloadConditionRows(status);
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Namespace</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Status" value={text(status.phase) || "-"} />
          <SummaryField label="Finalizers" value={stringList(record(detail.spec).finalizers).join(", ") || "-"} />
        </dl>
      </section>
      {conditions.length > 0 ? <ConditionsSection rows={conditions} /> : null}
      <ResourceQuotaSection rows={quotas} loading={quotasLoading} error={quotasError} />
      <LimitRangeSection rows={limitRanges} loading={limitRangesLoading} error={limitRangesError} />
    </>
  );
}

function ResourceQuotaSection({ rows, loading, error }: { rows: Record<string, unknown>[]; loading: boolean; error: string }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Resource Quotas</h3>
      </div>
      {error ? <div className="m-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <SimpleRowsTable
        columns={["Name", "Used", "Hard"]}
        rows={rows.map((item) => {
          const metadata = record(item.metadata);
          const status = record(item.status);
          return [text(metadata.name), resourceMapSummary(record(status.used)) || "-", resourceMapSummary(record(status.hard)) || "-"];
        })}
        empty={loading ? "Loading ResourceQuotas..." : "No ResourceQuotas found."}
      />
    </section>
  );
}

function LimitRangeSection({ rows, loading, error }: { rows: Record<string, unknown>[]; loading: boolean; error: string }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Limit Ranges</h3>
      </div>
      {error ? <div className="m-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <SimpleRowsTable
        columns={["Name", "Type", "Default", "Default Request", "Min", "Max"]}
        rows={rows.flatMap((item) => {
          const metadata = record(item.metadata);
          const limits = arrayRecords(record(item.spec).limits);
          if (limits.length === 0) return [[text(metadata.name), "-", "-", "-", "-", "-"]];
          return limits.map((limit) => [
            text(metadata.name),
            text(limit.type) || "-",
            resourceMapSummary(record(limit.default)) || "-",
            resourceMapSummary(record(limit.defaultRequest)) || "-",
            resourceMapSummary(record(limit.min)) || "-",
            resourceMapSummary(record(limit.max)) || "-"
          ]);
        })}
        empty={loading ? "Loading LimitRanges..." : "No LimitRanges found."}
      />
    </section>
  );
}

function NodeDetailsSection({ detail, pods, podsLoading, podsError }: { detail: Record<string, unknown>; pods: K8sResourceRow[]; podsLoading: boolean; podsError: string }) {
  const spec = record(detail.spec);
  const status = record(detail.status);
  const nodeInfo = record(status.nodeInfo);
  const addresses = arrayRecords(status.addresses);
  const taints = arrayRecords(spec.taints);
  const conditions = workloadConditionRows(status);
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Node</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Scheduling" value={spec.unschedulable ? "Disabled" : "Enabled"} />
          <SummaryField label="Pod CIDR" value={text(spec.podCIDR) || "-"} />
          <SummaryField label="Provider ID" value={text(spec.providerID) || "-"} />
          <SummaryField label="Taints" value={taints.map((taint) => `${text(taint.key)}=${text(taint.value)}:${text(taint.effect)}`).join(", ") || "-"} />
        </dl>
      </section>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Addresses</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {addresses.map((address) => (
            <SummaryField key={`${text(address.type)}-${text(address.address)}`} label={text(address.type) || "Address"} value={text(address.address)} />
          ))}
          {addresses.length === 0 ? <SummaryField label="Addresses" value="-" /> : null}
        </dl>
      </section>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Capacity</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Capacity" value={resourceMapSummary(record(status.capacity)) || "-"} />
          <SummaryField label="Allocatable" value={resourceMapSummary(record(status.allocatable)) || "-"} />
        </dl>
      </section>
      {Object.keys(nodeInfo).length > 0 ? (
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">System Info</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <SummaryField label="Architecture" value={text(nodeInfo.architecture)} />
            <SummaryField label="Operating System" value={text(nodeInfo.operatingSystem)} />
            <SummaryField label="OS Image" value={text(nodeInfo.osImage)} />
            <SummaryField label="Kernel Version" value={text(nodeInfo.kernelVersion)} />
            <SummaryField label="Container Runtime" value={text(nodeInfo.containerRuntimeVersion)} />
            <SummaryField label="Kubelet Version" value={text(nodeInfo.kubeletVersion)} />
            <SummaryField label="Kube Proxy Version" value={text(nodeInfo.kubeProxyVersion)} />
            <SummaryField label="Machine ID" value={text(nodeInfo.machineID)} />
            <SummaryField label="System UUID" value={text(nodeInfo.systemUUID)} />
            <SummaryField label="Boot ID" value={text(nodeInfo.bootID)} />
          </dl>
        </section>
      ) : null}
      {conditions.length > 0 ? <ConditionsSection rows={conditions} /> : null}
      <OwnedPodsSection rows={pods} loading={podsLoading} error={podsError} />
    </>
  );
}

function EndpointDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const row = serviceEndpointRow(detail);
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Endpoint Addresses</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <SummaryField label="Addresses" value={row.addresses.join(", ") || "-"} />
        <SummaryField label="Ports" value={row.ports.join(", ") || "-"} />
      </dl>
    </section>
  );
}

function EndpointSliceDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const row = serviceEndpointSliceRow(detail);
  const metadata = record(detail.metadata);
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">Endpoint Slice</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <SummaryField label="Service" value={text(record(metadata.labels)["kubernetes.io/service-name"]) || "-"} />
        <SummaryField label="Address Type" value={row.addressType || "-"} />
        <SummaryField label="Addresses" value={row.addresses.join(", ") || "-"} />
        <SummaryField label="Ports" value={row.ports.join(", ") || "-"} />
      </dl>
    </section>
  );
}

function GatewayApiDetailsSection({ detail, resourceId }: { detail: Record<string, unknown>; resourceId: string }) {
  const spec = record(detail.spec);
  const status = record(detail.status);
  if (resourceId === "gatewayclasses") {
    return (
      <>
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Gateway Class</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <SummaryField label="Controller Name" value={text(spec.controllerName) || "-"} />
          </dl>
        </section>
        <ConditionsSection rows={workloadConditionRows(status)} />
      </>
    );
  }

  if (resourceId === "gateways") {
    const addresses = arrayRecords(status.addresses);
    const listeners = arrayRecords(spec.listeners);
    return (
      <>
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Gateway</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <SummaryField label="Class Name" value={text(spec.gatewayClassName) || "-"} />
            <SummaryField label="Addresses" value={addresses.map((address) => [text(address.type), text(address.value)].filter(Boolean).join(":")).join(", ") || "-"} />
          </dl>
        </section>
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Listeners</h3>
          </div>
          <SimpleRowsTable
            columns={["Name", "Hostname", "Port", "Protocol", "TLS"]}
            rows={listeners.map((listener) => [
              text(listener.name) || "-",
              text(listener.hostname) || "*",
              text(listener.port) || "-",
              text(listener.protocol) || "-",
              text(record(listener.tls).mode) || "-"
            ])}
            empty="No listeners found."
          />
        </section>
        <ConditionsSection rows={workloadConditionRows(status)} />
      </>
    );
  }

  if (resourceId === "httproutes" || resourceId === "grpcroutes") {
    const rules = gatewayRouteRuleRows(detail, resourceId);
    const parentRefs = gatewayParentRefRows(detail);
    return (
      <>
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">{resourceId === "httproutes" ? "HTTPRoute" : "GRPCRoute"}</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <SummaryField label="Hostnames" value={stringList(spec.hostnames).join(", ") || "-"} />
            <SummaryField label="Parent Refs" value={parentRefs.length ? `${parentRefs.length} item${parentRefs.length === 1 ? "" : "s"}` : "-"} />
          </dl>
        </section>
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Parent Refs</h3>
          </div>
          <SimpleRowsTable columns={["Kind", "Name", "Namespace", "Section"]} rows={parentRefs} empty="No parent references found." />
        </section>
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Rules</h3>
          </div>
          <SimpleRowsTable columns={["Name", "Matches", "Backends", "Filters"]} rows={rules} empty="No rules found." />
        </section>
      </>
    );
  }

  if (resourceId === "referencegrants") {
    return (
      <>
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">From</h3>
          </div>
          <SimpleRowsTable
            columns={["Group", "Kind", "Namespace"]}
            rows={arrayRecords(spec.from).map((item) => [text(item.group) || "-", text(item.kind) || "-", text(item.namespace) || "-"])}
            empty="No source references found."
          />
        </section>
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">To</h3>
          </div>
          <SimpleRowsTable
            columns={["Group", "Kind", "Name"]}
            rows={arrayRecords(spec.to).map((item) => [text(item.group) || "-", text(item.kind) || "-", text(item.name) || "*"])}
            empty="No target references found."
          />
        </section>
      </>
    );
  }

  if (resourceId === "backendtlspolicies") {
    const targetRefs = gatewayTargetRefRows(spec.targetRefs);
    const validation = record(spec.validation);
    const caRefs = arrayRecords(validation.caCertificateRefs);
    return (
      <>
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Backend TLS Policy</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <SummaryField label="Hostname" value={text(validation.hostname) || "-"} />
            <SummaryField label="Target Refs" value={targetRefs.length ? `${targetRefs.length} item${targetRefs.length === 1 ? "" : "s"}` : "-"} />
            <SummaryField label="CA Certificate Refs" value={caRefs.length ? `${caRefs.length} item${caRefs.length === 1 ? "" : "s"}` : "-"} />
          </dl>
        </section>
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Target Refs</h3>
          </div>
          <SimpleRowsTable columns={["Group", "Kind", "Name", "Section"]} rows={targetRefs} empty="No target references found." />
        </section>
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">CA Certificate Refs</h3>
          </div>
          <SimpleRowsTable
            columns={["Group", "Kind", "Name"]}
            rows={caRefs.map((ref) => [text(ref.group) || "-", text(ref.kind) || "-", text(ref.name) || "-"])}
            empty="No CA certificate references found."
          />
        </section>
        <ConditionsSection rows={workloadConditionRows(status)} />
      </>
    );
  }

  if (resourceId === "xbackendtrafficpolicies") {
    const targetRefs = gatewayTargetRefRows(spec.targetRefs);
    const retryConstraint = record(spec.retryConstraint);
    const budget = record(retryConstraint.budget);
    const minRetryRate = record(retryConstraint.minRetryRate);
    const sessionPersistence = record(spec.sessionPersistence);
    return (
      <>
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Backend Traffic Policy</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <SummaryField label="Target Refs" value={targetRefs.length ? `${targetRefs.length} item${targetRefs.length === 1 ? "" : "s"}` : "-"} />
            <SummaryField label="Retry Budget" value={[text(budget.percent) ? `${text(budget.percent)}%` : "", text(budget.interval)].filter(Boolean).join(" / ") || "-"} />
            <SummaryField label="Min Retry Rate" value={[text(minRetryRate.count), text(minRetryRate.interval)].filter(Boolean).join(" / ") || "-"} />
            <SummaryField label="Session Persistence" value={Object.keys(sessionPersistence).length > 0 ? text(sessionPersistence) : "-"} />
          </dl>
        </section>
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Target Refs</h3>
          </div>
          <SimpleRowsTable columns={["Group", "Kind", "Name", "Section"]} rows={targetRefs} empty="No target references found." />
        </section>
        <ConditionsSection rows={workloadConditionRows(status)} />
      </>
    );
  }

  return null;
}

function CrdDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  const names = record(spec.names);
  const versions = Array.isArray(spec.versions) ? spec.versions.map((item) => record(item)) : [];
  const printerColumns = versions.flatMap((version) =>
    arrayRecords(version.additionalPrinterColumns).map((column) => [
      text(version.name) || "-",
      text(column.name) || "-",
      text(column.type) || "-",
      text(column.jsonPath) || "-",
      text(column.priority) || "0",
      text(column.description) || "-"
    ])
  );
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Custom Resource Definition</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Group" value={text(spec.group)} />
          <SummaryField label="Scope" value={text(spec.scope)} />
          <SummaryField label="Kind" value={text(names.kind)} />
          <SummaryField label="Plural" value={text(names.plural)} />
          <SummaryField label="Singular" value={text(names.singular)} />
          <SummaryField label="Short Names" value={stringList(names.shortNames).join(", ") || "-"} />
        </dl>
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Versions</h3>
        </div>
        <SimpleRowsTable
          columns={["Name", "Served", "Storage"]}
          rows={versions.map((version) => [text(version.name) || "-", summaryValue(version.served), summaryValue(version.storage)])}
          empty="No versions found."
        />
      </section>
      {printerColumns.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Additional Printer Columns</h3>
          </div>
          <SimpleRowsTable
            columns={["Version", "Name", "Type", "JSONPath", "Priority", "Description"]}
            rows={printerColumns}
            empty="No additional printer columns found."
          />
        </section>
      ) : null}
    </>
  );
}

function CustomResourceDetailsSection({ detail, resource }: { detail: Record<string, unknown>; resource: DiscoveredResource }) {
  const specRows = objectSummaryRows(record(detail.spec), 12);
  const status = record(detail.status);
  const conditionRows = workloadConditionRows(status);
  const statusRows = objectSummaryRows(
    Object.fromEntries(Object.entries(status).filter(([key]) => key !== "conditions")),
    12
  );
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Custom Resource</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Group" value={resource.group || "core"} />
          <SummaryField label="Version" value={resource.version} />
          <SummaryField label="Resource" value={resource.resource} />
          <SummaryField label="Scope" value={resource.namespaced ? "Namespaced" : "Cluster"} />
        </dl>
      </section>
      {specRows.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Spec</h3>
          </div>
          <SimpleRowsTable columns={["Field", "Value"]} rows={specRows} empty="No spec fields found." />
        </section>
      ) : null}
      {conditionRows.length > 0 ? <ConditionsSection rows={conditionRows} /> : null}
      {statusRows.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Status Fields</h3>
          </div>
          <SimpleRowsTable columns={["Field", "Value"]} rows={statusRows} empty="No status fields found." />
        </section>
      ) : null}
    </>
  );
}

function SimpleRowsTable({ columns, rows, empty }: { columns: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join("|")}`} className="border-t border-border">
              {row.map((value, columnIndex) => (
                <td key={`${rowIndex}-${columns[columnIndex]}`} className="px-4 py-3 text-muted-foreground">
                  <span className={columnIndex === 0 ? "font-mono text-xs text-foreground" : "font-mono text-xs"}>{value || "-"}</span>
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-muted-foreground" colSpan={columns.length}>{empty}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function SummaryField({ label, value, className, description }: { label: string; value: string; className?: string; description?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground" title={description}>{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-foreground">{value || "-"}</dd>
    </div>
  );
}

function MetadataMap({ title, values, empty }: { title: string; values: Record<string, string>; empty: string }) {
  const entries = Object.entries(values);
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {entries.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {entries.map(([key, value]) => (
            <span key={key} className="rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
              <span className="text-foreground">{key}</span>={value}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function InlineMetadataMap({ title, values, empty }: { title: string; values: Record<string, string>; empty: string }) {
  const entries = Object.entries(values);
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      {entries.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {entries.map(([key, value]) => (
            <span key={key} className="rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
              <span className="text-foreground">{key}</span>={value}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function serviceEndpointRow(detail: Record<string, unknown>): ServiceEndpointRow {
  const metadata = record(detail.metadata);
  const subsets = Array.isArray(detail.subsets) ? detail.subsets.map((item) => record(item)) : [];
  const addresses = new Set<string>();
  const ports = new Set<string>();
  for (const subset of subsets) {
    for (const address of arrayRecords(subset.addresses)) {
      const ip = text(address.ip);
      const hostname = text(address.hostname);
      if (ip || hostname) addresses.add([ip, hostname].filter(Boolean).join(" "));
    }
    for (const address of arrayRecords(subset.notReadyAddresses)) {
      const ip = text(address.ip);
      const hostname = text(address.hostname);
      if (ip || hostname) addresses.add(`${[ip, hostname].filter(Boolean).join(" ")} (not ready)`);
    }
    for (const port of arrayRecords(subset.ports)) {
      const name = text(port.name);
      const protocol = text(port.protocol) || "TCP";
      const value = text(port.port);
      if (value) ports.add(`${name ? `${name}:` : ""}${value}/${protocol}`);
    }
  }
  return {
    name: text(metadata.name),
    addresses: [...addresses],
    ports: [...ports],
    age: ageFromTimestamp(text(metadata.creationTimestamp))
  };
}

function serviceEndpointSliceRow(detail: Record<string, unknown>): ServiceEndpointRow {
  const metadata = record(detail.metadata);
  const endpoints = arrayRecords(detail.endpoints);
  const portsInput = arrayRecords(detail.ports);
  const addresses = new Set<string>();
  const ports = new Set<string>();
  for (const endpoint of endpoints) {
    for (const address of stringList(endpoint.addresses)) {
      if (address) addresses.add(address);
    }
  }
  for (const port of portsInput) {
    const name = text(port.name);
    const protocol = text(port.protocol) || "TCP";
    const value = text(port.port);
    if (value) ports.add(`${name ? `${name}:` : ""}${value}/${protocol}`);
  }
  return {
    name: text(metadata.name),
    addresses: [...addresses],
    ports: [...ports],
    addressType: text(detail.addressType),
    age: ageFromTimestamp(text(metadata.creationTimestamp))
  };
}

function ingressRuleRows(detail: Record<string, unknown>) {
  const rules = Array.isArray(record(detail.spec).rules) ? arrayRecords(record(detail.spec).rules) : [];
  return rules.flatMap((rule) => {
    const host = text(rule.host) || "*";
    const paths = arrayRecords(record(rule.http).paths);
    if (paths.length === 0) return [{ host, path: "", backend: "" }];
    return paths.map((path) => ({
      host,
      path: [text(path.path) || "/", text(path.pathType)].filter(Boolean).join(" "),
      backend: ingressBackendSummary(record(path.backend))
    }));
  });
}

function gatewayParentRefRows(detail: Record<string, unknown>) {
  return arrayRecords(record(detail.spec).parentRefs).map((ref) => [
    text(ref.kind) || "Gateway",
    text(ref.name) || "-",
    text(ref.namespace) || text(record(detail.metadata).namespace) || "-",
    text(ref.sectionName) || "-"
  ]);
}

function gatewayTargetRefRows(value: unknown) {
  return arrayRecords(value).map((ref) => [
    text(ref.group) || "-",
    text(ref.kind) || "Service",
    text(ref.name) || "-",
    text(ref.sectionName) || "-"
  ]);
}

function gatewayRouteRuleRows(detail: Record<string, unknown>, resourceId: string) {
  return arrayRecords(record(detail.spec).rules).map((rule, index) => [
    text(rule.name) || `rule-${index + 1}`,
    gatewayMatchesSummary(arrayRecords(rule.matches), resourceId),
    gatewayBackendRefsSummary(arrayRecords(rule.backendRefs)),
    arrayRecords(rule.filters).map((filter) => text(filter.type)).filter(Boolean).join(", ") || "-"
  ]);
}

function gatewayMatchesSummary(matches: Record<string, unknown>[], resourceId: string) {
  if (matches.length === 0) return "-";
  return matches
    .map((match) => {
      if (resourceId === "grpcroutes") {
        const method = record(match.method);
        return [text(method.service), text(method.method)].filter(Boolean).join("/") || text(method.type) || "match";
      }
      const path = record(match.path);
      const pathText = [text(path.type), text(path.value)].filter(Boolean).join(" ");
      const method = text(match.method);
      const headers = arrayRecords(match.headers).length;
      const queryParams = arrayRecords(match.queryParams).length;
      return [method, pathText, headers ? `${headers} headers` : "", queryParams ? `${queryParams} query params` : ""].filter(Boolean).join(", ") || "match";
    })
    .join("; ");
}

function gatewayBackendRefsSummary(refs: Record<string, unknown>[]) {
  if (refs.length === 0) return "-";
  return refs
    .map((ref) => {
      const kind = text(ref.kind) || "Service";
      const namespace = text(ref.namespace);
      const name = text(ref.name);
      const port = text(ref.port);
      const weight = text(ref.weight);
      return `${kind}:${namespace ? `${namespace}/` : ""}${name}${port ? `:${port}` : ""}${weight ? ` weight ${weight}` : ""}`;
    })
    .join("; ");
}

function ingressBackendSummary(backend: Record<string, unknown>) {
  const service = record(backend.service);
  if (Object.keys(service).length > 0) {
    const port = record(service.port);
    return `${text(service.name)}:${text(port.number) || text(port.name) || "-"}`;
  }
  const resource = record(backend.resource);
  if (Object.keys(resource).length > 0) {
    return `${text(resource.kind) || "Resource"}:${text(resource.name) || "-"}`;
  }
  return "";
}

function ingressClassParametersSummary(parameters: Record<string, unknown>) {
  if (Object.keys(parameters).length === 0) return "";
  return [text(parameters.apiGroup), text(parameters.kind), text(parameters.namespace), text(parameters.name), text(parameters.scope)].filter(Boolean).join(" / ");
}

function hpaMetricName(metric: Record<string, unknown>) {
  const type = text(metric.type);
  if (type === "Resource") return text(record(metric.resource).name) || "-";
  if (type === "ContainerResource") {
    const resource = record(metric.containerResource);
    return [text(resource.container), text(resource.name)].filter(Boolean).join(" / ") || "-";
  }
  if (type === "Pods") return text(record(record(metric.pods).metric).name) || "-";
  if (type === "Object") return text(record(record(metric.object).metric).name) || "-";
  if (type === "External") return text(record(record(metric.external).metric).name) || "-";
  return "-";
}

function hpaMetricTarget(metric: Record<string, unknown>) {
  const type = text(metric.type);
  const source =
    type === "Resource"
      ? record(metric.resource)
      : type === "ContainerResource"
        ? record(metric.containerResource)
        : type === "Pods"
          ? record(metric.pods)
          : type === "Object"
            ? record(metric.object)
            : type === "External"
              ? record(metric.external)
              : {};
  const target = record(source.target);
  return [text(target.type), text(target.averageUtilization) ? `${text(target.averageUtilization)}%` : "", text(target.averageValue), text(target.value)]
    .filter(Boolean)
    .join(" / ") || "-";
}

function ingressPorts(detail: Record<string, unknown>) {
  const ports = new Set<string>();
  for (const row of ingressRuleRows(detail)) {
    const parts = row.backend.split(":");
    if (parts[1]) ports.add(parts[1]);
  }
  if (arrayRecords(record(detail.spec).tls).length > 0) ports.add("443");
  return [...ports].sort((a, b) => a.localeCompare(b));
}

function namedRefs(value: unknown) {
  return arrayRecords(value).map((item) => text(item.name)).filter(Boolean);
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.map((item) => record(item)) : [];
}

function isWorkloadResource(resourceId: string, kind: string) {
  return ["deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs", "pods"].includes(resourceId) ||
    ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "Pod"].includes(kind);
}

function isOwnedPodResource(resourceId: string, kind: string) {
  return ["deployments", "statefulsets", "daemonsets", "replicasets", "jobs"].includes(resourceId) ||
    ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"].includes(kind);
}

function hasOwner(row: K8sResourceRow, kind: string, name: string, uid = "") {
  return row.ownerReferences?.some((owner) => owner.kind === kind && (uid ? owner.uid === uid : owner.name === name)) ?? false;
}

function supportsRevisionHistory(kind: string) {
  return ["Deployment", "DaemonSet", "StatefulSet"].includes(kind);
}

async function loadRevisionHistory(clusterId: string, namespace: string, name: string, detail: Record<string, unknown>) {
  const kind = text(detail.kind);
  if (kind === "Deployment") {
    const response = await api.resources(clusterId, "replicasets", [namespace]);
    const ownerUID = text(record(detail.metadata).uid);
    const owned = response.items.filter((row) => hasOwner(row, "Deployment", name, ownerUID));
    const details = await Promise.all(owned.map((row) => api.resourceDetail(clusterId, "replicasets", namespace, row.name)));
    const currentRevision = text(record(record(detail.metadata).annotations)["deployment.kubernetes.io/revision"]);
    const rows = details
      .map((item) => {
        const metadata = record(item.metadata);
        const revision = Number(record(metadata.annotations)["deployment.kubernetes.io/revision"]);
        if (!Number.isFinite(revision) || revision <= 0) return null;
        return {
          revision,
          createdAt: text(metadata.creationTimestamp),
          age: text(metadata.creationTimestamp) ? ageFromTimestamp(text(metadata.creationTimestamp)) : "",
          images: podTemplateImages(record(record(item.spec).template)),
          current: currentRevision ? String(revision) === currentRevision : false
        };
      })
      .filter((row): row is RevisionRow => row !== null)
      .sort((a, b) => b.revision - a.revision);
    return markLatestCurrent(rows);
  }

  if (kind === "DaemonSet" || kind === "StatefulSet") {
    const selector = workloadLabelSelector(detail);
    const response = await api.resources(clusterId, "controllerrevisions", [namespace], selector);
    const ownerUID = text(record(detail.metadata).uid);
    const owned = response.items.filter((row) => hasOwner(row, kind, name, ownerUID));
    const details = await Promise.all(owned.map((row) => api.resourceDetail(clusterId, "controllerrevisions", namespace, row.name)));
    const rows = details
      .map((item) => {
        const revision = Number(item.revision);
        if (!Number.isFinite(revision) || revision <= 0) return null;
        return {
          revision,
          createdAt: text(record(item.metadata).creationTimestamp),
          age: text(record(item.metadata).creationTimestamp) ? ageFromTimestamp(text(record(item.metadata).creationTimestamp)) : "",
          images: podTemplateImages(record(record(record(item.data).spec).template)),
          current: false
        };
      })
      .filter((row): row is RevisionRow => row !== null)
      .sort((a, b) => b.revision - a.revision);
    return markLatestCurrent(rows);
  }

  return [];
}

function markLatestCurrent(rows: RevisionRow[]) {
  if (rows.length === 0) return rows;
  if (rows.some((row) => row.current)) return rows;
  return rows.map((row, index) => ({ ...row, current: index === 0 }));
}

function podTemplateImages(template: Record<string, unknown>) {
  const spec = record(template.spec);
  const containers = Array.isArray(spec.containers) ? spec.containers : [];
  return containers.map((item) => text(record(item).image)).filter(Boolean);
}

function workloadLabelSelector(detail: Record<string, unknown>) {
  const matchLabels = stringRecord(record(record(detail.spec).selector).matchLabels);
  return Object.entries(matchLabels)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function workloadStrategyValue(spec: Record<string, unknown>) {
  const strategy = record(spec.strategy);
  const updateStrategy = record(spec.updateStrategy);
  if (text(strategy.type) === "RollingUpdate") {
    const rolling = record(strategy.rollingUpdate);
    const parts = [`RollingUpdate`];
    if (rolling.maxUnavailable !== undefined) parts.push(`max unavailable ${summaryValue(rolling.maxUnavailable)}`);
    if (rolling.maxSurge !== undefined) parts.push(`max surge ${summaryValue(rolling.maxSurge)}`);
    return parts.join(", ");
  }
  if (text(strategy.type)) return text(strategy.type);
  if (text(updateStrategy.type)) return text(updateStrategy.type);
  return "";
}

function workloadReplicaRows(kind: string, spec: Record<string, unknown>, status: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, unknown]> = [];
  if (kind === "DaemonSet") {
    rows.push(
      ["Desired", status.desiredNumberScheduled],
      ["Current", status.currentNumberScheduled],
      ["Ready", status.numberReady],
      ["Updated", status.updatedNumberScheduled],
      ["Available", status.numberAvailable],
      ["Unavailable", status.numberUnavailable]
    );
  } else if (kind === "Job") {
    rows.push(
      ["Completions", spec.completions],
      ["Parallelism", spec.parallelism],
      ["Active", status.active],
      ["Succeeded", status.succeeded],
      ["Failed", status.failed]
    );
  } else if (kind === "CronJob") {
    const active = Array.isArray(status.active) ? status.active.length : status.active;
    rows.push(
      ["Active Jobs", active],
      ["Last Schedule", status.lastScheduleTime],
      ["Last Successful", status.lastSuccessfulTime]
    );
  } else {
    rows.push(
      ["Desired", spec.replicas],
      ["Ready", status.readyReplicas],
      ["Updated", status.updatedReplicas],
      ["Available", status.availableReplicas],
      ["Total", status.replicas],
      ["Unavailable", status.unavailableReplicas]
    );
  }
  return rows
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => [label, summaryValue(value)]);
}

function workloadConditionRows(status: Record<string, unknown>): ConditionRow[] {
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  return conditions.map((item) => {
    const condition = record(item);
    const timestamp = text(condition.lastTransitionTime) || text(condition.lastProbeTime);
    return {
      type: text(condition.type),
      status: text(condition.status),
      reason: text(condition.reason),
      message: text(condition.message),
      age: timestamp ? ageFromTimestamp(timestamp) : ""
    };
  });
}

function workloadContainerRows(detail: Record<string, unknown>, field: "containers" | "initContainers" = "containers"): ContainerRow[] {
  const spec = record(detail.spec);
  const direct = Array.isArray(spec[field]) ? spec[field] : [];
  const template = record(record(spec.template).spec);
  const templateContainers = Array.isArray(template[field]) ? template[field] : [];
  const jobTemplate = record(record(record(spec.jobTemplate).spec).template);
  const jobTemplateSpec = record(jobTemplate.spec);
  const jobTemplateContainers = Array.isArray(jobTemplateSpec[field]) ? jobTemplateSpec[field] : [];
  const containers = direct.length > 0 ? direct : templateContainers.length > 0 ? templateContainers : jobTemplateContainers;
  return containers.map((item) => {
    const container = record(item);
    const resources = record(container.resources);
    return {
      name: text(container.name),
      image: text(container.image),
      pullPolicy: text(container.imagePullPolicy),
      ports: containerPorts(container),
      requests: resourceMapSummary(record(resources.requests)),
      limits: resourceMapSummary(record(resources.limits))
    };
  });
}

function containerPorts(container: Record<string, unknown>) {
  const ports = Array.isArray(container.ports) ? container.ports : [];
  return ports
    .map((item) => {
      const port = record(item);
      const name = text(port.name);
      const protocol = text(port.protocol) || "TCP";
      const containerPort = text(port.containerPort);
      return [name, containerPort].filter(Boolean).join(":") + (containerPort ? `/${protocol}` : "");
    })
    .filter(Boolean)
    .join(", ");
}

function resourceMapSummary(values: Record<string, unknown>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${summaryValue(value)}`)
    .join(", ");
}

function stripManagedFields(input: Record<string, unknown>) {
  const clone = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  const metadata = clone.metadata;
  if (metadata && typeof metadata === "object") {
    delete (metadata as Record<string, unknown>).managedFields;
  }
  return clone;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringRecord(value: unknown): Record<string, string> {
  const input = record(value);
  return Object.fromEntries(Object.entries(input).map(([key, val]) => [key, summaryValue(val)]));
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => summaryValue(item)).filter(Boolean);
}

function objectSummaryRows(value: Record<string, unknown>, limit: number) {
  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && item !== "")
    .slice(0, limit)
    .map(([key, item]) => [key, summaryValue(item)]);
}

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function summaryValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isSecretResource(item: K8sResourceRow, activeResource: ActiveResource) {
  return (
    item.kind.toLowerCase() === "secret" ||
    activeResource.id === "secrets" ||
    activeResource.watchDescriptor.resource === "secrets"
  );
}

function supportsScale(gvr: GVRDescriptor) {
  return gvr.group === "apps" && gvr.version === "v1" && ["deployments", "statefulsets", "replicasets"].includes(gvr.resource);
}

function isApplyConflictMessage(message: string) {
  const value = message.toLowerCase();
  return value.includes("conflict") || value.includes("apply conflict") || value.includes("field manager");
}

function isApplyConflictError(err: unknown, message: string) {
  return (err instanceof ApiError && err.status === 409) || isApplyConflictMessage(message);
}

function isPositiveApplyMessage(message: string) {
  return ["passed", "successfully", "Refreshed", "Restored"].some((value) => message.includes(value));
}

function validateYamlSyntax(value: string) {
  try {
    load(value);
    return "";
  } catch (err) {
    if (err instanceof YAMLException) {
      const mark = err.mark;
      const location = mark ? ` at line ${mark.line + 1}, column ${mark.column + 1}` : "";
      return `Invalid YAML${location}: ${err.reason || err.message}`;
    }
    return "Invalid YAML";
  }
}

function buildLineDiff(before: string, after: string): DiffRow[] {
  if (before === after) return [];
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  if (beforeLines.length * afterLines.length > 250_000) {
    return [
      { type: "remove", line: `${beforeLines.length} original lines` },
      { type: "add", line: `${afterLines.length} edited lines` }
    ];
  }

  const lengths = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0) as number[]);
  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = beforeLines[i] === afterLines[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      rows.push({ type: "same", line: beforeLines[i] });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      rows.push({ type: "remove", line: beforeLines[i] });
      i += 1;
    } else {
      rows.push({ type: "add", line: afterLines[j] });
      j += 1;
    }
  }
  while (i < beforeLines.length) {
    rows.push({ type: "remove", line: beforeLines[i] });
    i += 1;
  }
  while (j < afterLines.length) {
    rows.push({ type: "add", line: afterLines[j] });
    j += 1;
  }
  return rows;
}

function resourceRowKey(item: K8sResourceRow) {
  return `${item.namespace ?? ""}/${item.name}`;
}

function resourceRowFromObject(object: Record<string, unknown>): K8sResourceRow | null {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;
  const name = typeof meta.name === "string" ? meta.name : "";
  if (!name) return null;
  const namespace = typeof meta.namespace === "string" ? meta.namespace : undefined;
  const creationTimestamp = typeof meta.creationTimestamp === "string" ? meta.creationTimestamp : "";
  const ownerReferences = Array.isArray(meta.ownerReferences)
    ? meta.ownerReferences.map((item) => {
        const owner = record(item);
        return {
          apiVersion: text(owner.apiVersion),
          kind: text(owner.kind),
          name: text(owner.name),
          uid: text(owner.uid) || undefined,
          controller: Boolean(owner.controller)
        };
      })
    : undefined;
  return {
    name,
    namespace,
    kind: typeof object.kind === "string" ? object.kind : "",
    apiVersion: typeof object.apiVersion === "string" ? object.apiVersion : "",
    status: resourceStatusFromObject(object),
    age: creationTimestamp ? ageFromTimestamp(creationTimestamp) : "",
    ownerReferences
  };
}

function resourceStatusFromObject(object: Record<string, unknown>) {
  const status = object.status;
  if (status && typeof status === "object") {
    const statusRecord = status as Record<string, unknown>;
    if (typeof statusRecord.phase === "string" && statusRecord.phase) return statusRecord.phase;
    if (typeof statusRecord.readyReplicas === "number") {
      const spec = object.spec;
      const replicas = spec && typeof spec === "object" ? (spec as Record<string, unknown>).replicas : undefined;
      return typeof replicas === "number" && replicas > 0 ? `${statusRecord.readyReplicas}/${replicas} ready` : `${statusRecord.readyReplicas} ready`;
    }
    if (typeof statusRecord.availableReplicas === "number") {
      return `${statusRecord.availableReplicas} available`;
    }
  }
  return typeof object.type === "string" ? object.type : "";
}

function ageFromTimestamp(value: string) {
  const created = new Date(value).getTime();
  if (Number.isNaN(created)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - created) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
