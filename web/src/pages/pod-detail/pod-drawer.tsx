import { QueryState } from "../../components/ui/query-state";
import { Drawer } from "../../components/ui/drawer";
import { dump } from "js-yaml";
import {
  FileCode2,
  Plug,
  PlugZap,
  RefreshCcw,
  ScrollText,
  Star,
  TerminalSquare,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MetricSummary } from "../../components/metrics/metric-summary";
import { ActionMenu } from "../../components/ui/action-menu";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { YamlViewDialog } from "../../components/ui/yaml-view-dialog";
import type {
  ClusterEvent,
  MetricsRow,
  Pod,
  PodContainer,
  PodDetail,
  PodToleration,
  PodVolume,
} from "../../lib/api";
import { api } from "../../lib/api";
import { useFavorites } from "../../lib/favorites";
import { useOpenAPIDoc } from "../../lib/openapi";
import { cn } from "../../lib/utils";

export function PodDrawer({
  clusterId,
  pod,
  detail,
  error,
  onClose,
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
  const pinned = isFavorite({
    kind: "Pod",
    resource: "pods",
    namespace: pod.namespace,
    name: pod.name,
  });
  const [metric, setMetric] = useState<MetricsRow | null>(null);
  const [metricError, setMetricError] = useState("");
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [yamlDialogOpen, setYamlDialogOpen] = useState(false);
  const [resourceYaml, setResourceYaml] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlError, setYamlError] = useState("");
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
      const row =
        data.pods.find(
          (item) => item.namespace === pod.namespace && item.name === pod.name,
        ) ?? null;
      setMetric(row);
      setMetricError(row ? "" : "No metrics sample reported for this pod.");
    } catch (err) {
      setMetric(null);
      setMetricError(
        err instanceof Error ? err.message : "Failed to load pod metrics",
      );
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
            (event.regardingNamespace === pod.namespace ||
              event.namespace === pod.namespace),
        ),
      );
    } catch (err) {
      setEvents([]);
      setEventsError(
        err instanceof Error ? err.message : "Failed to load pod events",
      );
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
    setYamlError("");
  }, [pod.name, pod.namespace]);

  const openYaml = useCallback(async () => {
    if (!clusterId) return;
    setYamlLoading(true);
    setYamlError("");
    try {
      const resource = await api.resourceDetail(
        clusterId,
        "pods",
        pod.namespace,
        pod.name,
      );
      const nextYaml = dump(resource, { lineWidth: -1, noRefs: true });
      setResourceYaml(nextYaml);
      setYamlDialogOpen(true);
    } catch (err) {
      setYamlError(
        err instanceof Error ? err.message : "Failed to load pod YAML",
      );
    } finally {
      setYamlLoading(false);
    }
  }, [clusterId, pod.name, pod.namespace]);

  return (
    <>
      <Drawer title={pod.name} onClose={onClose} className="max-w-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card/95 p-5 backdrop-blur">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={pod.status === "Running" ? "success" : "warning"}>
                {pod.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {pod.namespace}
              </span>
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
                  disabled: yamlLoading,
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                toggleFavorite({
                  kind: "Pod",
                  resource: "pods",
                  namespace: pod.namespace,
                  name: pod.name,
                  route: "pods",
                })
              }
              aria-label={pinned ? `Unpin ${pod.name}` : `Pin ${pod.name}`}
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
              aria-label="Close pod detail"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-6 p-5">
          {error ? <QueryState error={error} /> : null}
          {yamlError ? <QueryState error={yamlError} /> : null}
          {!detail && !error ? (
            <div className="shimmer h-24 rounded-lg bg-muted" />
          ) : null}
          {detail ? (
            <>
              <section className="grid grid-cols-2 gap-3 text-sm">
                <Info label="Ready" value={detail.ready} />
                <Info label="Restarts" value={detail.restarts} />
                <Info
                  label="Pod IPs"
                  value={listSummary(detail.podIPs, detail.podIP)}
                />
                <Info
                  label="Host IPs"
                  value={listSummary(detail.hostIPs, detail.hostIP)}
                />
                <Info label="Node" value={detail.node || "-"} />
                <Info
                  label="Service Account"
                  value={detail.serviceAccountName || "-"}
                />
                <Info label="QoS Class" value={detail.qosClass || "-"} />
                <Info label="Priority" value={detail.priority ?? "-"} />
                <Info
                  label="Created"
                  value={formatTimestamp(detail.createdAt)}
                />
                <Info label="UID" value={detail.uid || "-"} />
              </section>

              <MetricSummary
                title="Pod metrics"
                metric={metric}
                unavailable={metricError}
              />

              <RelatedResourcesSection
                clusterId={clusterId}
                namespace={detail.namespace}
                node={detail.node}
                serviceAccount={detail.serviceAccountName}
                owners={detail.ownerReferences ?? []}
                onNavigate={navigate}
              />

              <ContainerDetailsSection
                title="Containers"
                containers={detail.containers}
              />
              {detail.initContainers && detail.initContainers.length > 0 ? (
                <ContainerDetailsSection
                  title="Init Containers"
                  containers={detail.initContainers}
                />
              ) : null}

              <VolumesSection volumes={detail.volumes ?? []} />
              <TolerationsSection tolerations={detail.tolerations ?? []} />

              <section>
                <h3 className="mb-2 text-sm font-semibold">Conditions</h3>
                <div className="space-y-2">
                  {detail.conditions.map((condition) => (
                    <div
                      key={condition.type}
                      className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm"
                    >
                      <div>
                        <div className="font-medium">{condition.type}</div>
                        {condition.message ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {condition.message}
                          </div>
                        ) : null}
                      </div>
                      <Badge
                        tone={condition.status === "True" ? "success" : "muted"}
                      >
                        {condition.status}
                      </Badge>
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
                <KeyValuePills
                  entries={Object.entries(detail.annotations ?? {})}
                  emptyText="No annotations."
                />
              </section>

              <PodEventsSection
                events={events}
                loading={eventsLoading}
                error={eventsError}
                onRefresh={loadEvents}
              />
            </>
          ) : null}
        </div>
      </Drawer>
      <YamlViewDialog
        open={yamlDialogOpen}
        onClose={() => setYamlDialogOpen(false)}
        title={`Pod YAML: ${pod.name}`}
        yaml={resourceYaml}
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

function KeyValuePills({
  entries,
  emptyText,
}: {
  entries: [string, string][];
  emptyText: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {entries.length > 0 ? (
        entries.map(([key, value]) => (
          <span
            key={key}
            className="max-w-full truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
            title={`${key}=${value}`}
          >
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
  onRefresh,
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCcw
            className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")}
          />
          Refresh
        </Button>
      </div>
      {error ? <QueryState error={error} /> : null}
      {!error && loading ? (
        <div className="shimmer h-16 rounded-md bg-muted" />
      ) : null}
      {!error && !loading && events.length === 0 ? (
        <span className="text-sm text-muted-foreground">No events.</span>
      ) : null}
      {!error && events.length > 0 ? (
        <div className="space-y-2">
          {events.slice(0, 8).map((event) => (
            <div
              key={`${event.namespace ?? ""}/${event.name}/${event.lastTimestamp}`}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate font-medium">
                  {event.reason || event.action || "Event"}
                </div>
                <Badge tone={event.type === "Warning" ? "warning" : "muted"}>
                  {event.type || "Normal"}
                </Badge>
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {event.note || "-"}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {event.age || event.lastTimestamp || event.eventTime}
              </div>
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
  onNavigate,
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
          onClick={
            node ? () => onNavigate(`/clusters/${clusterId}/nodes`) : undefined
          }
        />
        <RelatedResourceRow
          label="Service Account"
          value={serviceAccount || "-"}
          onClick={
            serviceAccount
              ? () => onNavigate(`/clusters/${clusterId}/serviceaccounts`)
              : undefined
          }
        />
        <RelatedResourceRow
          label="Controlled By"
          value={controller ? `${controller.kind}/${controller.name}` : "-"}
          meta={controller?.apiVersion}
        />
        <RelatedResourceRow
          label="Namespace"
          value={namespace}
          onClick={() => onNavigate(`/clusters/${clusterId}/namespaces`)}
        />
      </div>
    </section>
  );
}

function RelatedResourceRow({
  label,
  value,
  meta,
  onClick,
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
          <button
            type="button"
            onClick={onClick}
            className="max-w-full truncate text-left font-medium text-primary hover:underline"
          >
            {value}
          </button>
        ) : (
          <span className="block truncate font-medium">{value}</span>
        )}
        {meta ? (
          <div className="truncate text-xs text-muted-foreground">{meta}</div>
        ) : null}
      </div>
    </div>
  );
}

function ContainerDetailsSection({
  title,
  containers,
}: {
  title: string;
  containers: PodContainer[];
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="space-y-2">
        {containers.map((container) => (
          <div
            key={container.name}
            className="rounded-md border border-border p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-medium">
                {container.name}
              </span>
              <Badge tone={container.ready ? "success" : "warning"}>
                {container.state}
              </Badge>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {container.image}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <DetailChip label="Restarts" value={container.restarts} />
              <DetailChip
                label="Pull Policy"
                value={container.pullPolicy || "-"}
              />
              <DetailChip label="Ports" value={portsSummary(container.ports)} />
              <DetailChip
                label="Requests"
                value={resourceSummary(container.requests)}
              />
              <DetailChip
                label="Limits"
                value={resourceSummary(container.limits)}
                className="sm:col-span-2"
              />
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
            <div
              key={volume.name}
              className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate font-medium">
                {volume.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {volume.type}
              </span>
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
            <div
              key={`${toleration.key ?? ""}-${toleration.effect ?? ""}-${index}`}
              className="rounded-md border border-border p-3 text-xs"
            >
              <div className="font-mono text-foreground">
                {toleration.key || "*"}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
                <DetailChip
                  label="Operator"
                  value={toleration.operator || "-"}
                />
                <DetailChip label="Value" value={toleration.value || "-"} />
                <DetailChip label="Effect" value={toleration.effect || "-"} />
                <DetailChip
                  label="Seconds"
                  value={toleration.tolerationSeconds ?? "-"}
                />
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

function DetailChip({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div
      className={cn("min-w-0 rounded-md bg-muted/60 px-2 py-1.5", className)}
    >
      <div className="uppercase text-muted-foreground">{label}</div>
      <div
        className="mt-0.5 truncate font-medium text-foreground"
        title={String(value)}
      >
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
