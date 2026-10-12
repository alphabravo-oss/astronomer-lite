import { Plus, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
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
import {
  accessCheckFromSettled,
  accessStatusMessage,
  idleAccessCheck,
  isAccessBlocked,
  pendingAccessCheck,
  type AccessCheck,
} from "../lib/access";
import type {
  ApplyResponse,
  DiscoveredResource,
  K8sResourceRow,
  WatchFrame,
} from "../lib/api";
import { api, ApiError } from "../lib/api";
import {
  accessReviewForResource,
  createTemplate,
  resourceRowFromObject,
  resourceRowKey,
  resourceUnavailableMessage,
  sameResourceRow,
  type ActiveResource,
} from "../lib/resource-detail";
import { resourceByRoute } from "../lib/resources";
import { tableKeyboardNavigation } from "../lib/table-preferences";
import { cn } from "../lib/utils";

import { CreateYamlDialog } from "./resource-detail/create-yaml-dialog";
import { ResourceDrawer } from "./resource-detail/resource-drawer";

type SortKey = "name" | "namespace" | "kind" | "status" | "age";
const resourcePageSizeOptions = [25, 50, 100] as const;
const resourcePageSizeStorageKey = "astronomer-lite-resource-page-size";

type ResourceListPageProps = {
  resourceId?: string;
  discoveredResource?: DiscoveredResource;
  selectedNamespaces: string[];
  refreshSignal?: number;
};

export function ResourceListPage({
  resourceId,
  discoveredResource,
  selectedNamespaces,
  refreshSignal = 0,
}: ResourceListPageProps) {
  const { clusterId = "", resource = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const config = resourceByRoute(resourceId ?? resource);
  const [servedVersion, setServedVersion] = useState<{
    cluster: string;
    resource: string;
    version: string;
  } | null>(null);
  const activeResource = useMemo<ActiveResource | null>(() => {
    if (discoveredResource) {
      return {
        id: discoveredResource.resource,
        label: discoveredResource.kind || discoveredResource.resource,
        namespaced: discoveredResource.namespaced,
        apiVersion: discoveredResource.groupVersion,
        watchDescriptor: discoveredResource,
      };
    }
    if (!config) return null;
    const version =
      servedVersion?.cluster === clusterId &&
      servedVersion.resource === config.id
        ? servedVersion.version
        : config.version;
    return {
      id: config.id,
      label: config.label,
      namespaced: config.namespaced,
      apiVersion: config.apiGroup ? `${config.apiGroup}/${version}` : version,
      watchDescriptor: {
        group: config.apiGroup,
        version,
        resource: config.resource,
        kind: config.label,
        namespaced: config.namespaced,
      },
    };
  }, [config, discoveredResource, clusterId, servedVersion]);
  const table = useTablePreferences(
    `resources:${activeResource?.apiVersion}:${activeResource?.id}`,
    [
      { key: "name", label: "Name", width: 280 },
      { key: "namespace", label: "Namespace" },
      { key: "kind", label: "Kind" },
      { key: "status", label: "Status" },
      { key: "age", label: "Age", width: 100 },
    ],
  );
  const [items, setItems] = useState<K8sResourceRow[]>([]);
  const [selected, setSelected] = useState<K8sResourceRow | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("namespace");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() =>
    readResourcePageSize(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createYaml, setCreateYaml] = useState("");
  const [validatedCreateYaml, setValidatedCreateYaml] = useState("");
  const [createState, setCreateState] = useState<
    "idle" | "dry-running" | "applying"
  >("idle");
  const [createError, setCreateError] = useState("");
  const [createResponse, setCreateResponse] = useState<ApplyResponse | null>(
    null,
  );
  const [createAccess, setCreateAccess] =
    useState<AccessCheck>(idleAccessCheck);

  useEffect(() => {
    const name = searchParams.get("name");
    if (!name || !activeResource) return;
    let cancelled = false;
    const namespace = searchParams.get("namespace") ?? "";
    const load = discoveredResource
      ? api.gvrResourceDetail(clusterId, discoveredResource, namespace, name)
      : api.resourceDetail(clusterId, activeResource.id, namespace, name);
    load
      .then((object) => {
        if (!cancelled) setSelected(resourceRowFromObject(object));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, activeResource, discoveredResource, searchParams]);

  function clearResourceLink() {
    if (!searchParams.has("name")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("name");
    next.delete("namespace");
    setSearchParams(next, { replace: true });
  }

  const loadResources = useCallback(async () => {
    if (!clusterId || !activeResource) return;
    setLoading(true);
    try {
      const namespaces = activeResource.namespaced ? selectedNamespaces : [];
      const response = discoveredResource
        ? await api.gvrResources(clusterId, discoveredResource, namespaces)
        : await api.resources(clusterId, activeResource.id, namespaces);
      if (!discoveredResource && response.apiVersion) {
        const version = response.apiVersion.split("/").at(-1)!;
        setServedVersion((previous) =>
          previous?.cluster === clusterId &&
          previous.resource === activeResource.id &&
          previous.version === version
            ? previous
            : { cluster: clusterId, resource: activeResource.id, version },
        );
      }
      setItems(response.items);
      setError("");
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 404 &&
        !discoveredResource
      ) {
        setError(resourceUnavailableMessage(activeResource));
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to load resources",
        );
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
      api.canI(
        clusterId,
        accessReviewForResource(
          activeResource.watchDescriptor,
          "create",
          activeResource.namespaced
            ? selectedNamespaces[0] || "default"
            : undefined,
        ),
      ),
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
        const index = current.findIndex(
          (item) => resourceRowKey(item) === rowKey,
        );
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
    },
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
      ? api.gvrResourceDetail(
          clusterId,
          discoveredResource,
          selected.namespace ?? "",
          selected.name,
        )
      : api.resourceDetail(
          clusterId,
          activeResource.id,
          selected.namespace ?? "",
          selected.name,
        );
    request
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled)
          setDetailError(
            err instanceof Error
              ? err.message
              : "Failed to load resource detail",
          );
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
        .includes(value),
    );
  }, [items, query]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const result = String(a[sortKey] ?? "").localeCompare(
        String(b[sortKey] ?? ""),
      );
      return sortDirection === "asc" ? result : -result;
    });
  }, [filteredItems, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const pageItems = useMemo(
    () => sortedItems.slice((page - 1) * pageSize, page * pageSize),
    [page, pageSize, sortedItems],
  );

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
    window.localStorage.setItem(
      resourcePageSizeStorageKey,
      String(nextPageSize),
    );
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
    if (!clusterId || !createYaml.trim() || isAccessBlocked(createAccess))
      return;
    setCreateState("dry-running");
    setCreateError("");
    try {
      const response = await api.applyManifests(clusterId, createYaml, true);
      setCreateResponse(response);
      setValidatedCreateYaml(createYaml);
    } catch (err) {
      setCreateResponse(null);
      setValidatedCreateYaml("");
      setCreateError(
        err instanceof Error ? err.message : "Failed to dry-run manifest",
      );
    } finally {
      setCreateState("idle");
    }
  }

  async function applyCreateYaml() {
    if (
      !clusterId ||
      !validatedCreateYaml ||
      createYaml !== validatedCreateYaml ||
      isAccessBlocked(createAccess)
    )
      return;
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
      setCreateError(
        err instanceof Error ? err.message : "Failed to apply manifest",
      );
    } finally {
      setCreateState("idle");
    }
  }

  if (!activeResource) {
    return (
      <div className="text-sm text-muted-foreground">
        Unknown resource type.
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={activeResource.label}
        description={
          <>
            {activeResource.apiVersion ? (
              <span className="mr-2 font-mono text-xs">
                {activeResource.apiVersion}/{activeResource.id}
              </span>
            ) : null}
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
            <Button
              variant="secondary"
              onClick={() => void loadResources()}
              disabled={loading}
            >
              <RefreshCcw
                className={cn("h-4 w-4", loading && "animate-spin")}
              />
              Refresh
            </Button>
          </>
        }
      />

      <div className="text-xs uppercase text-muted-foreground">
        Watch: {watchStatus}
      </div>

      {error ? (
        <QueryState error={error} onRetry={() => void loadResources()} />
      ) : null}

      <TableTools
        table={table}
        rows={sortedItems.map((r) => ({
          name: r.name,
          namespace: r.namespace || "-",
          kind: r.kind || activeResource.label,
          status: r.status || "-",
          age: r.age,
        }))}
        filename={activeResource.id}
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
        <div className="border-b border-border p-3">
          <SearchInput
            className="max-w-md"
            id={`${activeResource.id}-filter`}
            name={`${activeResource.id}-filter`}
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            placeholder={`Filter ${activeResource.label.toLowerCase()}`}
          />
        </div>
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
                label="Kind"
                sortKey="kind"
                style={table.style("kind", true)}
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
              <SortableHeader
                label="Age"
                sortKey="age"
                style={table.style("age", true)}
                active={sortKey}
                direction={sortDirection}
                onSort={toggleSort}
              />
            </tr>
          </thead>
          <tbody>
            {pageItems.map((item) => (
              <tr
                key={`${item.namespace ?? "_cluster"}/${item.name}`}
                tabIndex={0}
                className="table-row-hover k8s-row"
                onClick={() => setSelected(item)}
              >
                <td style={table.style("name")} className="k8s-td-name">
                  <button
                    className="text-left hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setSelected(item)}
                  >
                    {item.name}
                  </button>
                </td>
                <td style={table.style("namespace")} className="k8s-td-muted">
                  {item.namespace || "-"}
                </td>
                <td style={table.style("kind")} className="k8s-td-muted">
                  {item.kind || activeResource.label}
                </td>
                <td style={table.style("status")} className="k8s-td">
                  {item.status ? (
                    <StatusBadge status={item.status} label={item.status} />
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td style={table.style("age")} className="k8s-td-muted">
                  {item.age}
                </td>
              </tr>
            ))}
            {sortedItems.length === 0 ? (
              <tr>
                <td
                  className="bg-card px-4 py-8 text-center text-muted-foreground"
                  colSpan={5}
                >
                  {loading ? "Loading resources..." : "No resources found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <TablePagination
          total={sortedItems.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          pageSizeOptions={resourcePageSizeOptions}
          onPageSizeChange={changePageSize}
          className="border-t border-border"
        />
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
            clearResourceLink();
            setItems((current) =>
              current.filter(
                (item) => resourceRowKey(item) !== resourceRowKey(deleted),
              ),
            );
            setSelected(null);
            setDetail(null);
            setDetailError("");
            void loadResources();
          }}
          onClose={() => {
            clearResourceLink();
            setSelected(null);
            setDetail(null);
            setDetailError("");
          }}
        />
      ) : null}
      <CreateYamlDialog
        open={createOpen}
        yaml={createYaml}
        validated={
          validatedCreateYaml !== "" && createYaml === validatedCreateYaml
        }
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
  const stored = Number(
    window.localStorage.getItem(resourcePageSizeStorageKey),
  );
  return resourcePageSizeOptions.includes(
    stored as (typeof resourcePageSizeOptions)[number],
  )
    ? stored
    : resourcePageSizeOptions[0];
}
