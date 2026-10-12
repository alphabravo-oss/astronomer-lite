import type {
  DiscoveredResource,
  K8sResourceRow,
  SecretReveal,
} from "../../lib/api";
import { lookupFieldDoc, type OpenAPIDocument } from "../../lib/openapi";
import {
  isConfiguredResource,
  isWorkloadResource,
  stringRecord,
  summaryValue,
  type ActiveResource,
  type RevisionRow,
  type ServiceEndpointRow,
} from "../../lib/resource-detail";
import { record, text } from "../../lib/utils";
import {
  CustomResourceDetailsSection,
  MetadataMap,
  ResourceSpecificSections,
  SecretDataSection,
  SummaryField,
  WorkloadDetailsSection,
} from "./sections";

export function ResourceSummary({
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
  openApiDoc,
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
  const ownerRefs = Array.isArray(metadata.ownerReferences)
    ? metadata.ownerReferences
    : [];
  const status = record(detail.status);
  const showWorkloadDetails = isWorkloadResource(
    activeResource.id,
    text(detail.kind),
  );
  const showCustomResourceDetails =
    discoveredResource !== undefined &&
    !isConfiguredResource(discoveredResource);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-lg border border-border bg-background p-4 text-sm sm:grid-cols-2">
        <SummaryField label="Kind" value={text(detail.kind)} />
        <SummaryField label="API Version" value={text(detail.apiVersion)} />
        <SummaryField
          label="Namespace"
          value={text(metadata.namespace) || "-"}
        />
        <SummaryField
          label="Created"
          value={text(metadata.creationTimestamp) || "-"}
        />
        <SummaryField
          label="UID"
          value={text(metadata.uid)}
          className="sm:col-span-2"
        />
        <SummaryField
          label="Resource Version"
          value={text(metadata.resourceVersion)}
        />
        <SummaryField label="Generation" value={text(metadata.generation)} />
      </section>

      {Object.keys(status).length > 0 ? (
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Status</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {Object.entries(status)
              .slice(0, 8)
              .map(([key, value]) => (
                <SummaryField
                  key={key}
                  label={key}
                  value={summaryValue(value)}
                  description={
                    openApiDoc
                      ? lookupFieldDoc(
                          openApiDoc,
                          text(detail.kind),
                          text(detail.apiVersion),
                          `status.${key}`,
                        )
                      : undefined
                  }
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

      {showCustomResourceDetails ? (
        <CustomResourceDetailsSection
          detail={detail}
          resource={discoveredResource}
        />
      ) : null}

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
      <MetadataMap
        title="Annotations"
        values={annotations}
        empty="No annotations"
      />

      {ownerRefs.length > 0 ? (
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Owners</h3>
          <div className="space-y-2">
            {ownerRefs.map((owner, index) => {
              const ownerRecord = record(owner);
              return (
                <div
                  key={`${text(ownerRecord.kind)}-${text(ownerRecord.name)}-${index}`}
                  className="rounded-md bg-muted px-3 py-2"
                >
                  <div className="font-mono text-xs text-foreground">
                    {text(ownerRecord.name) || "Unknown"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {text(ownerRecord.kind) || "Owner"}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
