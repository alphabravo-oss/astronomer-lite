import { dump } from "js-yaml";
import { FileCode2, Plug, Scale, Star, Trash2, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { MetricSummary } from "../../components/metrics/metric-summary";
import { Button } from "../../components/ui/button";
import { CodeBlock } from "../../components/ui/code-block";
import { YamlViewDialog } from "../../components/ui/yaml-view-dialog";
import {
  accessCheckFromSettled,
  accessDeniedMessage,
  accessStatusMessage,
  idleAccessCheck,
  isAccessBlocked,
  pendingAccessCheck,
  type AccessCheck,
} from "../../lib/access";
import type {
  ClusterEvent,
  DiscoveredResource,
  K8sResourceRow,
  MetricsRow,
  SecretReveal,
} from "../../lib/api";
import { api } from "../../lib/api";
import { useFavorites } from "../../lib/favorites";
import { useOpenAPIDoc } from "../../lib/openapi";
import {
  accessReviewForResource,
  formatNodeDrainMessage,
  isPositiveActionMessage,
  isPositiveApplyMessage,
  isSecretResource,
  stripManagedFields,
  supportsRevisionHistory,
  supportsScale,
  type ActiveResource,
} from "../../lib/resource-detail";
import { cn, record, text } from "../../lib/utils";
import { ServicePortsSection } from "./sections";
import { useRelatedResources } from "./use-related-resources";
import { useResourceYaml } from "./use-resource-yaml";

import { ObjectEventsPanel } from "./object-events-panel";
import { ResourceDiff } from "./resource-diff";
import { ResourceSummary } from "./resource-summary";
const YamlEditor = lazy(() =>
  import("../../components/ui/yaml-editor").then((module) => ({
    default: module.YamlEditor,
  })),
);

export function ResourceDrawer({
  clusterId,
  item,
  detail,
  error,
  activeResource,
  discoveredResource,
  onApplied,
  onDeleted,
  onClose,
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
  const [view, setView] = useState<"summary" | "events" | "yaml" | "json">(
    "summary",
  );
  const [actionState, setActionState] = useState<
    "idle" | "scaling" | "deleting" | "cordoning" | "draining" | "rolling-back"
  >("idle");
  const [rollbackRevision, setRollbackRevision] = useState<number | null>(null);
  const openApiDoc = useOpenAPIDoc(clusterId);
  const { isFavorite, toggleFavorite } = useFavorites(clusterId);
  const pinned = isFavorite({
    kind: item.kind,
    resource: activeResource.id,
    namespace: item.namespace,
    name: item.name,
  });
  const [actionMessage, setActionMessage] = useState("");
  const [replicas, setReplicas] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [drainConfirm, setDrainConfirm] = useState("");
  const [drainForce, setDrainForce] = useState(false);
  const [drainDeleteEmptyDirData, setDrainDeleteEmptyDirData] = useState(false);
  const [revealedSecrets, setRevealedSecrets] = useState<
    Record<string, SecretReveal>
  >({});
  const [revealingSecretKey, setRevealingSecretKey] = useState("");
  const [secretError, setSecretError] = useState("");
  const [nodeMetric, setNodeMetric] = useState<MetricsRow | null>(null);
  const [nodeMetricError, setNodeMetricError] = useState("");
  const [objectEvents, setObjectEvents] = useState<ClusterEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [updateAccess, setUpdateAccess] =
    useState<AccessCheck>(idleAccessCheck);
  const [deleteAccess, setDeleteAccess] =
    useState<AccessCheck>(idleAccessCheck);
  const [scaleAccess, setScaleAccess] = useState<AccessCheck>(idleAccessCheck);
  const cleanedDetail = useMemo(
    () => (detail ? stripManagedFields(detail) : null),
    [detail],
  );
  const related = useRelatedResources(
    clusterId,
    item,
    activeResource,
    cleanedDetail,
  );
  const yaml = useMemo(
    () =>
      cleanedDetail ? dump(cleanedDetail, { lineWidth: -1, noRefs: true }) : "",
    [cleanedDetail],
  );
  const json = useMemo(
    () => (cleanedDetail ? JSON.stringify(cleanedDetail, null, 2) : ""),
    [cleanedDetail],
  );
  const scalable = supportsScale(activeResource.watchDescriptor);
  const nodeUnschedulable =
    activeResource.id === "nodes" &&
    Boolean(record(record(detail).spec).unschedulable);
  const secretReadOnly = isSecretResource(item, activeResource);
  const canEdit = !secretReadOnly && !isAccessBlocked(updateAccess);
  const canDelete = !isAccessBlocked(deleteAccess);
  const canScale = scalable && !isAccessBlocked(scaleAccess);
  const {
    editMode,
    setEditMode,
    yamlDialogOpen,
    setYamlDialogOpen,
    editedYaml,
    applyConflict,
    applyState,
    applyMessage,
    preRefreshYaml,
    diffRows,
    yamlValidationError,
    hasYamlChanges,
    canApplyValidatedYaml,
    forceApplyValidated,
    updateEditedYaml,
    resetEditedYaml,
    validateYaml,
    applyValidatedYaml,
    refreshYamlFromServer,
    restorePreRefreshYaml,
  } = useResourceYaml({
    clusterId,
    item,
    activeResource,
    discoveredResource,
    cleanedDetail,
    yaml,
    canEdit,
    onApplied,
    onViewChange: setView,
  });
  const editHint = secretReadOnly
    ? "Secret YAML is read-only because values are masked."
    : accessStatusMessage(updateAccess) ||
      "Edit uses Kubernetes server-side apply.";

  useEffect(() => {
    setRevealedSecrets({});
    setRevealingSecretKey("");
    setSecretError("");
    setActionMessage("");
    setDeleteConfirm("");
    setDrainConfirm("");
    setDrainForce(false);
    setDrainDeleteEmptyDirData(false);
    setObjectEvents([]);
    setEventsError("");
  }, [item.name, item.namespace]);

  useEffect(() => {
    let cancelled = false;
    const namespace = activeResource.namespaced
      ? item.namespace || undefined
      : undefined;
    const descriptor = activeResource.watchDescriptor;
    const updateRequest = accessReviewForResource(
      descriptor,
      "patch",
      namespace,
      item.name,
    );
    const deleteRequest = accessReviewForResource(
      descriptor,
      "delete",
      namespace,
      item.name,
    );
    const scaleRequest = scalable
      ? accessReviewForResource(
          descriptor,
          "patch",
          namespace,
          item.name,
          "scale",
        )
      : null;
    setUpdateAccess(pendingAccessCheck);
    setDeleteAccess(pendingAccessCheck);
    setScaleAccess(scaleRequest ? pendingAccessCheck : idleAccessCheck);
    void Promise.allSettled([
      api.canI(clusterId, updateRequest),
      api.canI(clusterId, deleteRequest),
      scaleRequest ? api.canI(clusterId, scaleRequest) : Promise.resolve(null),
    ]).then(([updateResult, deleteResult, scaleResult]) => {
      if (cancelled) return;
      setUpdateAccess(accessCheckFromSettled(updateResult));
      setDeleteAccess(accessCheckFromSettled(deleteResult));
      setScaleAccess(accessCheckFromSettled(scaleResult));
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeResource.namespaced,
    activeResource.watchDescriptor,
    clusterId,
    item.name,
    item.namespace,
    scalable,
  ]);

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
      setNodeMetricError(
        row ? "" : "No metrics sample reported for this node.",
      );
    } catch (err) {
      setNodeMetric(null);
      setNodeMetricError(
        err instanceof Error ? err.message : "Failed to load node metrics",
      );
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

  const loadObjectEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError("");
    try {
      const rows = await api.events(
        clusterId,
        item.namespace ? [item.namespace] : [],
      );
      const kind =
        item.kind ||
        activeResource.watchDescriptor.kind ||
        activeResource.label;
      const next = rows.filter((event) => {
        const sameName = event.regardingName === item.name;
        const sameKind =
          !kind ||
          event.regardingKind === kind ||
          event.regardingKind === activeResource.label;
        const sameNamespace =
          !item.namespace ||
          event.regardingNamespace === item.namespace ||
          event.namespace === item.namespace;
        return sameName && sameKind && sameNamespace;
      });
      setObjectEvents(next);
    } catch (err) {
      setObjectEvents([]);
      setEventsError(
        err instanceof Error ? err.message : "Failed to load events",
      );
    } finally {
      setEventsLoading(false);
    }
  }, [
    activeResource.label,
    activeResource.watchDescriptor.kind,
    clusterId,
    item.kind,
    item.name,
    item.namespace,
  ]);

  useEffect(() => {
    if (view !== "events") return;
    void loadObjectEvents();
  }, [loadObjectEvents, view]);

  async function revealSecretKey(key: string) {
    if (!item.namespace) return;
    setRevealingSecretKey(key);
    setSecretError("");
    try {
      const secret = await api.revealSecretKey(
        clusterId,
        item.namespace,
        item.name,
        key,
      );
      setRevealedSecrets((current) => ({ ...current, [key]: secret }));
    } catch (err) {
      setSecretError(
        err instanceof Error ? err.message : "Failed to reveal secret key",
      );
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
      setActionMessage(
        "Replicas must be a whole number greater than or equal to 0.",
      );
      return;
    }
    setActionState("scaling");
    setActionMessage("");
    try {
      await (discoveredResource
        ? api.scaleGVRResource(
            clusterId,
            discoveredResource,
            item.namespace ?? "",
            item.name,
            nextReplicas,
          )
        : api.scaleResource(
            clusterId,
            activeResource.id,
            item.namespace ?? "",
            item.name,
            nextReplicas,
          ));
      const nextDetail = discoveredResource
        ? await api.gvrResourceDetail(
            clusterId,
            discoveredResource,
            item.namespace ?? "",
            item.name,
          )
        : await api.resourceDetail(
            clusterId,
            activeResource.id,
            item.namespace ?? "",
            item.name,
          );
      onApplied(nextDetail);
      setActionMessage(
        `Scaled to ${nextReplicas} replica${nextReplicas === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : "Failed to scale resource",
      );
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
      await api.rollbackResource(
        clusterId,
        activeResource.id,
        item.namespace,
        item.name,
        revision,
      );
      const nextDetail = discoveredResource
        ? await api.gvrResourceDetail(
            clusterId,
            discoveredResource,
            item.namespace,
            item.name,
          )
        : await api.resourceDetail(
            clusterId,
            activeResource.id,
            item.namespace,
            item.name,
          );
      onApplied(nextDetail);
      setActionMessage(`Rolled back to revision ${revision}.`);
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : "Failed to roll back",
      );
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
        await api.deleteGVRResource(
          clusterId,
          discoveredResource,
          item.namespace ?? "",
          item.name,
        );
      } else {
        await api.deleteResource(
          clusterId,
          activeResource.id,
          item.namespace ?? "",
          item.name,
        );
      }
      onDeleted(item);
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : "Failed to delete resource",
      );
      setActionState("idle");
    }
  }

  async function setNodeUnschedulable(unschedulable: boolean) {
    if (activeResource.id !== "nodes" || !cleanedDetail || !canEdit) return;
    const nextDetail = JSON.parse(JSON.stringify(cleanedDetail)) as Record<
      string,
      unknown
    >;
    const spec = record(nextDetail.spec);
    spec.unschedulable = unschedulable;
    nextDetail.spec = spec;
    setActionState("cordoning");
    setActionMessage("");
    try {
      const nextYaml = dump(nextDetail, { lineWidth: -1, noRefs: true });
      const applied = discoveredResource
        ? await api.applyGVRResource(
            clusterId,
            discoveredResource,
            item.namespace ?? "",
            item.name,
            nextYaml,
            false,
          )
        : await api.applyResource(
            clusterId,
            activeResource.id,
            item.namespace ?? "",
            item.name,
            nextYaml,
            false,
          );
      onApplied(applied);
      setActionMessage(unschedulable ? "Node cordoned." : "Node uncordoned.");
    } catch (err) {
      setActionMessage(
        err instanceof Error
          ? err.message
          : `Failed to ${unschedulable ? "cordon" : "uncordon"} node`,
      );
    } finally {
      setActionState("idle");
    }
  }

  async function drainNode() {
    if (activeResource.id !== "nodes" || !canEdit || drainConfirm !== item.name)
      return;
    setActionState("draining");
    setActionMessage("");
    try {
      const result = await api.drainNode(clusterId, item.name, {
        force: drainForce,
        deleteEmptyDirData: drainDeleteEmptyDirData,
      });
      const nextDetail = discoveredResource
        ? await api.gvrResourceDetail(
            clusterId,
            discoveredResource,
            item.namespace ?? "",
            item.name,
          )
        : await api.resourceDetail(
            clusterId,
            activeResource.id,
            item.namespace ?? "",
            item.name,
          );
      onApplied(nextDetail);
      setActionMessage(formatNodeDrainMessage(result));
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : "Failed to drain node",
      );
    } finally {
      setActionState("idle");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-xs">
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
              onClick={() =>
                toggleFavorite({
                  kind: item.kind,
                  resource: activeResource.id,
                  namespace: item.namespace,
                  name: item.name,
                  route: activeResource.id,
                })
              }
              aria-label={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
              aria-pressed={pinned}
              title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
            >
              <Star
                className={cn(
                  "h-4 w-4",
                  pinned ? "fill-yellow-400 text-yellow-400" : "",
                )}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close resource detail"
            >
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
                  view === mode
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
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
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Scheduling
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {nodeUnschedulable
                        ? "This node is cordoned and will not receive new Pods."
                        : "This node is schedulable for new Pods."}
                    </p>
                    <Button
                      className="mt-3"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void setNodeUnschedulable(!nodeUnschedulable)
                      }
                      disabled={!canEdit || actionState !== "idle"}
                      title={accessStatusMessage(updateAccess) || undefined}
                    >
                      {actionState === "cordoning"
                        ? "Updating..."
                        : nodeUnschedulable
                          ? "Uncordon"
                          : "Cordon"}
                    </Button>
                  </div>
                ) : null}
                {activeResource.id === "nodes" ? (
                  <div className="rounded-md border border-border bg-card p-3">
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      htmlFor={`drain-${item.name}`}
                    >
                      Drain
                    </label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cordons the node and evicts eligible Pods. DaemonSet and
                      static Pods are skipped.
                    </p>
                    <div className="mt-2 space-y-2">
                      <label className="flex items-start gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={drainForce}
                          onChange={(event) =>
                            setDrainForce(event.target.checked)
                          }
                          disabled={!canEdit || actionState !== "idle"}
                          className="mt-0.5 rounded border-border text-primary focus:ring-ring"
                        />
                        Evict unmanaged Pods
                      </label>
                      <label className="flex items-start gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={drainDeleteEmptyDirData}
                          onChange={(event) =>
                            setDrainDeleteEmptyDirData(event.target.checked)
                          }
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
                        onChange={(event) =>
                          setDrainConfirm(event.target.value)
                        }
                        placeholder={item.name}
                        disabled={!canEdit || actionState !== "idle"}
                        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-hidden focus:ring-2 focus:ring-ring"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void drainNode()}
                        disabled={
                          !canEdit ||
                          actionState !== "idle" ||
                          drainConfirm !== item.name
                        }
                        title={accessStatusMessage(updateAccess) || undefined}
                      >
                        {actionState === "draining" ? "Draining..." : "Drain"}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {activeResource.id === "services" && item.namespace ? (
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Port-forward
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Forward a Service port through one of its backing Pods.
                    </p>
                    <Button
                      className="mt-3"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/clusters/${clusterId}/services/${encodeURIComponent(item.namespace ?? "")}/${encodeURIComponent(item.name)}/port-forward`,
                        )
                      }
                    >
                      <Plug className="h-3.5 w-3.5" />
                      Forward
                    </Button>
                  </div>
                ) : null}
                {scalable ? (
                  <div className="rounded-md border border-border bg-card p-3">
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      htmlFor={`replicas-${item.name}`}
                    >
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
                        className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm outline-hidden focus:ring-2 focus:ring-ring"
                      />
                      <Button
                        size="sm"
                        onClick={() => void scaleResource()}
                        disabled={
                          actionState !== "idle" ||
                          !replicas.trim() ||
                          !canScale
                        }
                        title={accessStatusMessage(scaleAccess) || undefined}
                      >
                        {actionState === "scaling" ? "Scaling..." : "Scale"}
                      </Button>
                    </div>
                    {accessDeniedMessage(scaleAccess) ? (
                      <p className="mt-2 text-xs text-destructive">
                        {accessDeniedMessage(scaleAccess)}
                      </p>
                    ) : null}
                    {activeResource.id === "replicasets" ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Deployment-owned ReplicaSets may be reconciled by their
                        owner.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
                    Scale is available for Deployments, StatefulSets, and
                    ReplicaSets.
                  </div>
                )}
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <label
                    className="text-xs font-medium uppercase tracking-wide text-destructive"
                    htmlFor={`delete-${item.name}`}
                  >
                    Delete
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Type the resource name to confirm deletion.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      id={`delete-${item.name}`}
                      value={deleteConfirm}
                      onChange={(event) => setDeleteConfirm(event.target.value)}
                      placeholder={item.name}
                      disabled={!canDelete}
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-hidden focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void deleteResource()}
                      disabled={
                        actionState !== "idle" ||
                        deleteConfirm !== item.name ||
                        !canDelete
                      }
                      title={accessStatusMessage(deleteAccess) || undefined}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {actionState === "deleting" ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                  {accessDeniedMessage(deleteAccess) ? (
                    <p className="mt-2 text-xs text-destructive">
                      {accessDeniedMessage(deleteAccess)}
                    </p>
                  ) : null}
                </div>
              </div>
              {actionMessage ? (
                <div
                  className={cn(
                    "mt-3 rounded-md border p-3 text-sm",
                    isPositiveActionMessage(actionMessage)
                      ? "border-status-success/35 bg-status-success/10 text-status-success"
                      : "border-destructive/35 bg-destructive/10 text-destructive",
                  )}
                >
                  {actionMessage}
                </div>
              ) : null}
            </section>
          ) : null}
          {view === "yaml" && cleanedDetail ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
              <div className="text-sm text-muted-foreground">{editHint}</div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setYamlDialogOpen(true)}
                >
                  Open YAML
                </Button>
                {canEdit ? (
                  <>
                    {editMode ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={resetEditedYaml}
                          disabled={applyState !== "idle"}
                        >
                          Reset
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void validateYaml()}
                          disabled={
                            applyState !== "idle" ||
                            !hasYamlChanges ||
                            Boolean(yamlValidationError)
                          }
                        >
                          {applyState === "dry-running"
                            ? "Validating..."
                            : "Dry run"}
                        </Button>
                        {applyConflict ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void validateYaml(true)}
                            disabled={
                              applyState !== "idle" ||
                              !hasYamlChanges ||
                              Boolean(yamlValidationError)
                            }
                          >
                            Force dry run
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          onClick={() => void applyValidatedYaml()}
                          disabled={
                            applyState !== "idle" || !canApplyValidatedYaml
                          }
                        >
                          {applyState === "applying"
                            ? "Applying..."
                            : forceApplyValidated
                              ? "Force apply"
                              : "Apply"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditMode(true)}
                        disabled={!canEdit}
                        title={accessStatusMessage(updateAccess) || undefined}
                      >
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
                  : "border-destructive/35 bg-destructive/10 text-destructive",
              )}
            >
              {applyMessage}
              {applyConflict || preRefreshYaml ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {preRefreshYaml ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={restorePreRefreshYaml}
                      disabled={applyState !== "idle"}
                    >
                      Restore pre-refresh edits
                    </Button>
                  ) : null}
                  {applyConflict ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void refreshYamlFromServer()}
                      disabled={applyState !== "idle"}
                    >
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
          {error ? (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {secretError ? (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
              {secretError}
            </div>
          ) : null}
          {!detail && !error ? (
            <div className="shimmer h-48 rounded-lg bg-muted" />
          ) : null}
          {cleanedDetail && view === "summary" ? (
            <>
              {activeResource.id === "nodes" ? (
                <MetricSummary
                  title="Node metrics"
                  metric={nodeMetric}
                  unavailable={nodeMetricError}
                />
              ) : null}
              {activeResource.id === "services" && item.namespace ? (
                <ServicePortsSection
                  detail={cleanedDetail}
                  onForward={(port) =>
                    navigate(
                      `/clusters/${clusterId}/services/${encodeURIComponent(item.namespace ?? "")}/${encodeURIComponent(item.name)}/port-forward?port=${port}`,
                    )
                  }
                />
              ) : null}
              <ResourceSummary
                {...related}
                detail={cleanedDetail}
                activeResource={activeResource}
                discoveredResource={discoveredResource}
                onRollback={
                  canEdit &&
                  supportsRevisionHistory(text(cleanedDetail?.kind ?? ""))
                    ? rollbackToRevision
                    : undefined
                }
                rollbackingRevision={rollbackRevision}
                openApiDoc={openApiDoc}
                secretState={
                  canEdit
                    ? undefined
                    : {
                        revealed: revealedSecrets,
                        revealingKey: revealingSecretKey,
                        onReveal: (key) => void revealSecretKey(key),
                        onHide: hideSecretKey,
                      }
                }
              />
            </>
          ) : null}
          {cleanedDetail && view === "events" ? (
            <ObjectEventsPanel
              events={objectEvents}
              loading={eventsLoading}
              error={eventsError}
              onRefresh={() => void loadObjectEvents()}
            />
          ) : null}
          {cleanedDetail && view === "yaml" ? (
            editMode && canEdit ? (
              <div className="space-y-4">
                <Suspense
                  fallback={
                    <div className="shimmer min-h-96 rounded-lg bg-muted" />
                  }
                >
                  <YamlEditor
                    value={editedYaml}
                    onChange={updateEditedYaml}
                    kind={item.kind || activeResource.label}
                    apiVersion={item.apiVersion || activeResource.apiVersion}
                    openApiDoc={openApiDoc}
                  />
                </Suspense>
                <ResourceDiff
                  rows={diffRows}
                  unchanged={!hasYamlChanges}
                  validated={canApplyValidatedYaml}
                />
              </div>
            ) : (
              <CodeBlock
                code={yaml}
                language="yaml"
                title={`${item.kind || "Resource"} YAML`}
                showLineNumbers
              />
            )
          ) : null}
          {cleanedDetail && view === "json" ? (
            <CodeBlock
              code={json}
              language="json"
              title={`${item.kind || "Resource"} JSON`}
              showLineNumbers
            />
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetEditedYaml}
                  disabled={applyState !== "idle"}
                >
                  Reset
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void validateYaml()}
                  disabled={
                    applyState !== "idle" ||
                    !hasYamlChanges ||
                    Boolean(yamlValidationError)
                  }
                >
                  {applyState === "dry-running" ? "Validating..." : "Dry run"}
                </Button>
                {applyConflict ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void validateYaml(true)}
                    disabled={
                      applyState !== "idle" ||
                      !hasYamlChanges ||
                      Boolean(yamlValidationError)
                    }
                  >
                    Force dry run
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  onClick={() => void applyValidatedYaml()}
                  disabled={applyState !== "idle" || !canApplyValidatedYaml}
                >
                  {applyState === "applying"
                    ? "Applying..."
                    : forceApplyValidated
                      ? "Force apply"
                      : "Apply"}
                </Button>
              </>
            ) : null
          }
          message={
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{editHint}</p>
              {applyMessage ? (
                <div
                  className={cn(
                    "whitespace-pre-line rounded-md border p-3 text-sm",
                    isPositiveApplyMessage(applyMessage)
                      ? "border-status-success/35 bg-status-success/10 text-status-success"
                      : "border-destructive/35 bg-destructive/10 text-destructive",
                  )}
                >
                  {applyMessage}
                  {applyConflict || preRefreshYaml ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {preRefreshYaml ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={restorePreRefreshYaml}
                          disabled={applyState !== "idle"}
                        >
                          Restore pre-refresh edits
                        </Button>
                      ) : null}
                      {applyConflict ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void refreshYamlFromServer()}
                          disabled={applyState !== "idle"}
                        >
                          Refresh YAML
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {editMode && canEdit && yamlValidationError ? (
                <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
                  {yamlValidationError}
                </div>
              ) : null}
            </div>
          }
          childrenAfterEditor={
            editMode && canEdit ? (
              <ResourceDiff
                rows={diffRows}
                unchanged={!hasYamlChanges}
                validated={canApplyValidatedYaml}
              />
            ) : null
          }
        />
      ) : null}
    </div>
  );
}
