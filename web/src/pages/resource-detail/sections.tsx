// Resource-specific detail sections and presentational primitives for the
// resource drawer. Extracted from resource-list.tsx; rendering only — the
// pure data helpers live in ../../lib/resource-detail.
import { Check, Copy, Eye, EyeOff, Plug } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { StatusBadge } from "../../components/ui/status-badge";
import type { DiscoveredResource, K8sResourceRow, SecretReveal } from "../../lib/api";
import {
  arrayRecords,
  gatewayParentRefRows,
  gatewayRouteRuleRows,
  gatewayTargetRefRows,
  hpaMetricName,
  hpaMetricTarget,
  ingressBackendSummary,
  ingressClassParametersSummary,
  ingressPorts,
  ingressRuleRows,
  isOwnedPodResource,
  namedRefs,
  objectSummaryRows,
  resourceMapSummary,
  serviceEndpointRow,
  serviceEndpointSliceRow,
  servicePortRows,
  stringList,
  stringRecord,
  summaryValue,
  supportsRevisionHistory,
  webhookClientSummary,
  workloadConditionRows,
  workloadContainerRows,
  workloadReplicaRows,
  workloadStrategyValue,
  type ActiveResource,
  type ConditionRow,
  type ContainerRow,
  type RevisionRow,
  type ServiceEndpointRow
} from "../../lib/resource-detail";
import { record, text } from "../../lib/utils";

type ResourceSpecificSectionsProps = {
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
};

// Maps a resource id to the section(s) rendered below the generic summary in
// the drawer. Several ids share a renderer (e.g. all RBAC bindings, all
// Gateway API kinds), so this lookup replaces a long if/else chain.
const resourceSectionRenderers: Record<string, (props: ResourceSpecificSectionsProps) => ReactNode> = {
  services: (props) => {
    const spec = record(props.detail.spec);
    return (
      <>
        <section className="rounded-lg border border-border bg-background p-4">
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
        <ServiceEndpointsSection rows={props.serviceEndpoints} loading={props.serviceEndpointsLoading} error={props.serviceEndpointsError} />
        <ServiceEndpointsSection
          title="Endpoint Slices"
          description="EndpointSlice addresses selected by this Service."
          rows={props.serviceEndpointSlices}
          loading={props.serviceEndpointSlicesLoading}
          error={props.serviceEndpointSlicesError}
        />
      </>
    );
  },
  ingresses: ({ detail }) => <IngressDetailsSection detail={detail} />,
  ingressclasses: ({ detail }) => <IngressClassDetailsSection detail={detail} />,
  configmaps: ({ detail }) => <ConfigMapDataSection detail={detail} />,
  priorityclasses: ({ detail }) => <PriorityClassDetailsSection detail={detail} />,
  runtimeclasses: ({ detail }) => <RuntimeClassDetailsSection detail={detail} />,
  serviceaccounts: ({ detail }) => <ServiceAccountReferencesSection detail={detail} />,
  networkpolicies: ({ detail }) => <NetworkPolicyDetailsSection detail={detail} />,
  horizontalpodautoscalers: ({ detail }) => <HorizontalPodAutoscalerDetailsSection detail={detail} />,
  verticalpodautoscalers: ({ detail }) => <VerticalPodAutoscalerDetailsSection detail={detail} />,
  jobsets: ({ detail }) => <JobSetDetailsSection detail={detail} />,
  poddisruptionbudgets: ({ detail }) => <PodDisruptionBudgetDetailsSection detail={detail} />,
  resourcequotas: ({ detail }) => <ResourceQuotaDetailsSection detail={detail} />,
  limitranges: ({ detail }) => <LimitRangeDetailsSection detail={detail} />,
  leases: ({ detail }) => <LeaseDetailsSection detail={detail} />,
  endpoints: ({ detail }) => <EndpointDetailsSection detail={detail} />,
  endpointslices: ({ detail }) => <EndpointSliceDetailsSection detail={detail} />,
  crds: ({ detail }) => <CrdDetailsSection detail={detail} />,
  roles: ({ detail }) => <RoleRulesSection detail={detail} />,
  clusterroles: ({ detail }) => <RoleRulesSection detail={detail} />,
  rolebindings: ({ detail }) => <RoleBindingSubjectsSection detail={detail} />,
  clusterrolebindings: ({ detail }) => <RoleBindingSubjectsSection detail={detail} />,
  persistentvolumes: ({ detail, activeResource }) => <StorageDetailsSection detail={detail} resourceId={activeResource.id} />,
  persistentvolumeclaims: ({ detail, activeResource }) => <StorageDetailsSection detail={detail} resourceId={activeResource.id} />,
  storageclasses: ({ detail, activeResource }) => <StorageDetailsSection detail={detail} resourceId={activeResource.id} />,
  mutatingwebhookconfigurations: ({ detail, activeResource }) => <WebhookConfigurationDetailsSection detail={detail} resourceId={activeResource.id} />,
  validatingwebhookconfigurations: ({ detail, activeResource }) => <WebhookConfigurationDetailsSection detail={detail} resourceId={activeResource.id} />,
  gateways: ({ detail, activeResource }) => <GatewayApiDetailsSection detail={detail} resourceId={activeResource.id} />,
  gatewayclasses: ({ detail, activeResource }) => <GatewayApiDetailsSection detail={detail} resourceId={activeResource.id} />,
  httproutes: ({ detail, activeResource }) => <GatewayApiDetailsSection detail={detail} resourceId={activeResource.id} />,
  grpcroutes: ({ detail, activeResource }) => <GatewayApiDetailsSection detail={detail} resourceId={activeResource.id} />,
  referencegrants: ({ detail, activeResource }) => <GatewayApiDetailsSection detail={detail} resourceId={activeResource.id} />,
  backendtlspolicies: ({ detail, activeResource }) => <GatewayApiDetailsSection detail={detail} resourceId={activeResource.id} />,
  xbackendtrafficpolicies: ({ detail, activeResource }) => <GatewayApiDetailsSection detail={detail} resourceId={activeResource.id} />,
  namespaces: (props) => (
    <NamespaceDetailsSection
      detail={props.detail}
      quotas={props.namespaceQuotas}
      quotasLoading={props.namespaceQuotasLoading}
      quotasError={props.namespaceQuotasError}
      limitRanges={props.namespaceLimitRanges}
      limitRangesLoading={props.namespaceLimitRangesLoading}
      limitRangesError={props.namespaceLimitRangesError}
    />
  ),
  nodes: (props) => (
    <NodeDetailsSection detail={props.detail} pods={props.nodePods} podsLoading={props.nodePodsLoading} podsError={props.nodePodsError} />
  )
};

export function ResourceSpecificSections(props: ResourceSpecificSectionsProps) {
  const render = resourceSectionRenderers[props.activeResource.id];
  if (!render) return null;
  const node = render(props);
  return node ? <>{node}</> : null;
}

export function WorkloadDetailsSection({
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

export function ConditionsSection({ rows }: { rows: ConditionRow[] }) {
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

export function OwnedPodsSection({ rows, loading, error }: { rows: K8sResourceRow[]; loading: boolean; error: string }) {
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

export function OwnedJobsSection({ rows, loading, error }: { rows: K8sResourceRow[]; loading: boolean; error: string }) {
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

export function RevisionHistorySection({
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

export function ContainerSpecSection({ title, rows }: { title: string; rows: ContainerRow[] }) {
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

export function ServicePortsSection({ detail, onForward }: { detail: Record<string, unknown>; onForward: (port: number) => void }) {
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

export function SecretDataSection({
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

export function ServiceEndpointsSection({
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

export function IngressDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function IngressClassDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function StorageDetailsSection({ detail, resourceId }: { detail: Record<string, unknown>; resourceId: string }) {
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

export function HorizontalPodAutoscalerDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function VerticalPodAutoscalerDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  const status = record(detail.status);
  const targetRef = record(spec.targetRef);
  const updatePolicy = record(spec.updatePolicy);
  const policy = record(spec.resourcePolicy);
  const containerPolicies = arrayRecords(policy.containerPolicies);
  const recommendation = arrayRecords(record(status.recommendation).containerRecommendations);
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">Vertical Pod Autoscaler</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Target" value={[text(targetRef.kind), text(targetRef.name)].filter(Boolean).join("/") || "-"} />
          <SummaryField label="Update Mode" value={text(updatePolicy.updateMode) || "Auto"} />
          <SummaryField label="Recommenders" value={summaryValue(arrayRecords(spec.recommenders).length)} />
          <SummaryField label="Container Policies" value={summaryValue(containerPolicies.length)} />
        </dl>
      </section>
      {recommendation.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Recommendation</h3>
          </div>
          <SimpleRowsTable
            columns={["Container", "Target", "Lower Bound", "Upper Bound", "Uncapped Target"]}
            rows={recommendation.map((rec) => [
              text(rec.containerName) || "-",
              resourceMapSummary(record(rec.target)) || "-",
              resourceMapSummary(record(rec.lowerBound)) || "-",
              resourceMapSummary(record(rec.upperBound)) || "-",
              resourceMapSummary(record(rec.uncappedTarget)) || "-"
            ])}
            empty="No recommendations yet."
          />
        </section>
      ) : null}
    </>
  );
}

export function JobSetDetailsSection({ detail }: { detail: Record<string, unknown> }) {
  const spec = record(detail.spec);
  const status = record(detail.status);
  const replicatedJobs = arrayRecords(spec.replicatedJobs);
  const jobStatuses = arrayRecords(status.replicatedJobsStatus);
  const statusByName = new Map<string, Record<string, unknown>>();
  for (const entry of jobStatuses) {
    const name = text(entry.name);
    if (name) statusByName.set(name, entry);
  }
  return (
    <>
      <section className="rounded-lg border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-semibold">JobSet</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <SummaryField label="Success Policy" value={text(record(spec.successPolicy).operator) || "-"} />
          <SummaryField label="Failure Policy" value={text(record(spec.failurePolicy).operator) || "-"} />
          <SummaryField label="Replicated Jobs" value={summaryValue(replicatedJobs.length)} />
          <SummaryField label="Suspend" value={summaryValue(spec.suspend)} />
        </dl>
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Replicated Jobs</h3>
        </div>
        <SimpleRowsTable
          columns={["Name", "Replicas", "Ready", "Succeeded", "Failed", "Active"]}
          rows={replicatedJobs.map((job) => {
            const name = text(job.name) || "-";
            const st = statusByName.get(name) ?? {};
            return [
              name,
              text(job.replicas) || "1",
              text(st.ready) || "0",
              text(st.succeeded) || "0",
              text(st.failed) || "0",
              text(st.active) || "0"
            ];
          })}
          empty="No replicated jobs."
        />
      </section>
      <ConditionsSection rows={workloadConditionRows(status)} />
    </>
  );
}

export function ResourceQuotaDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function LimitRangeDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function LeaseDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function ConfigMapDataSection({ detail }: { detail: Record<string, unknown> }) {
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

export function RoleRulesSection({ detail }: { detail: Record<string, unknown> }) {
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

export function RoleBindingSubjectsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function PriorityClassDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function RuntimeClassDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function WebhookConfigurationDetailsSection({ detail, resourceId }: { detail: Record<string, unknown>; resourceId: string }) {
  const webhooks = arrayRecords(detail.webhooks);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{resourceId === "mutatingwebhookconfigurations" ? "Mutating Webhooks" : "Validating Webhooks"}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{webhooks.length} webhook{webhooks.length === 1 ? "" : "s"} configured.</p>
      </div>
      <div className="divide-y divide-border">
        {webhooks.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">No webhooks found.</div>
        ) : (
          webhooks.map((webhook) => {
            const name = text(webhook.name) || "webhook";
            const rules = arrayRecords(webhook.rules);
            const namespaceSelector = stringRecord(record(webhook.namespaceSelector).matchLabels);
            const objectSelector = stringRecord(record(webhook.objectSelector).matchLabels);
            return (
              <div key={name} className="px-4 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="font-mono text-sm font-semibold">{name}</h4>
                  <span className="text-xs text-muted-foreground">{webhookClientSummary(record(webhook.clientConfig))}</span>
                </div>
                <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                  <SummaryField label="Failure Policy" value={text(webhook.failurePolicy) || "-"} />
                  <SummaryField label="Match Policy" value={text(webhook.matchPolicy) || "-"} />
                  <SummaryField label="Side Effects" value={text(webhook.sideEffects) || "-"} />
                  <SummaryField label="Timeout" value={text(webhook.timeoutSeconds) ? `${text(webhook.timeoutSeconds)}s` : "-"} />
                  <SummaryField label="Reinvocation Policy" value={text(webhook.reinvocationPolicy) || "-"} />
                  <SummaryField label="Admission Versions" value={stringList(webhook.admissionReviewVersions).join(", ") || "-"} />
                </dl>
                {rules.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rules</p>
                    <SimpleRowsTable
                      columns={["Operations", "API Groups", "API Versions", "Resources", "Scope"]}
                      rows={rules.map((rule) => [
                        stringList(rule.operations).join(", ") || "*",
                        stringList(rule.apiGroups).join(", ") || "*",
                        stringList(rule.apiVersions).join(", ") || "*",
                        stringList(rule.resources).join(", ") || "*",
                        text(rule.scope) || "*"
                      ])}
                      empty="No rule matchers."
                    />
                  </div>
                ) : null}
                {Object.keys(namespaceSelector).length > 0 || Object.keys(objectSelector).length > 0 ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <InlineMetadataMap title="Namespace Selector" values={namespaceSelector} empty="No namespace selector" />
                    <InlineMetadataMap title="Object Selector" values={objectSelector} empty="No object selector" />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function ServiceAccountReferencesSection({ detail }: { detail: Record<string, unknown> }) {
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

export function NetworkPolicyDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function PodDisruptionBudgetDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function NamespaceDetailsSection({
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

export function ResourceQuotaSection({ rows, loading, error }: { rows: Record<string, unknown>[]; loading: boolean; error: string }) {
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

export function LimitRangeSection({ rows, loading, error }: { rows: Record<string, unknown>[]; loading: boolean; error: string }) {
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

export function NodeDetailsSection({ detail, pods, podsLoading, podsError }: { detail: Record<string, unknown>; pods: K8sResourceRow[]; podsLoading: boolean; podsError: string }) {
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

export function EndpointDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function EndpointSliceDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function GatewayApiDetailsSection({ detail, resourceId }: { detail: Record<string, unknown>; resourceId: string }) {
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

export function CrdDetailsSection({ detail }: { detail: Record<string, unknown> }) {
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

export function CustomResourceDetailsSection({ detail, resource }: { detail: Record<string, unknown>; resource: DiscoveredResource }) {
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

export function SimpleRowsTable({ columns, rows, empty }: { columns: string[]; rows: string[][]; empty: string }) {
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

export function SummaryField({ label, value, className, description }: { label: string; value: string; className?: string; description?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground" title={description}>{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-foreground">{value || "-"}</dd>
    </div>
  );
}

export function MetadataMap({ title, values, empty }: { title: string; values: Record<string, string>; empty: string }) {
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

export function InlineMetadataMap({ title, values, empty }: { title: string; values: Record<string, string>; empty: string }) {
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
