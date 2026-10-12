import { useEffect, useState } from "react";
import type { K8sResourceRow } from "../../lib/api";
import { api } from "../../lib/api";
import {
  hasOwner,
  isOwnedPodResource,
  loadRevisionHistory,
  serviceEndpointRow,
  serviceEndpointSliceRow,
  supportsRevisionHistory,
  workloadLabelSelector,
  type ActiveResource,
  type RevisionRow,
  type ServiceEndpointRow,
} from "../../lib/resource-detail";
import { record, text } from "../../lib/utils";

// Related inventories share the selected object's lifetime. Each request ignores
// late results when the user selects a different resource.
export function useRelatedResources(
  clusterId: string,
  item: K8sResourceRow,
  activeResource: ActiveResource,
  cleanedDetail: Record<string, unknown> | null,
) {
  const [ownedPods, setOwnedPods] = useState<K8sResourceRow[]>([]);
  const [ownedPodsLoading, setOwnedPodsLoading] = useState(false);
  const [ownedPodsError, setOwnedPodsError] = useState("");
  const [ownedJobs, setOwnedJobs] = useState<K8sResourceRow[]>([]);
  const [ownedJobsLoading, setOwnedJobsLoading] = useState(false);
  const [ownedJobsError, setOwnedJobsError] = useState("");
  const [revisionHistory, setRevisionHistory] = useState<RevisionRow[]>([]);
  const [revisionHistoryLoading, setRevisionHistoryLoading] = useState(false);
  const [revisionHistoryError, setRevisionHistoryError] = useState("");
  const [serviceEndpoints, setServiceEndpoints] = useState<
    ServiceEndpointRow[]
  >([]);
  const [serviceEndpointsLoading, setServiceEndpointsLoading] = useState(false);
  const [serviceEndpointsError, setServiceEndpointsError] = useState("");
  const [serviceEndpointSlices, setServiceEndpointSlices] = useState<
    ServiceEndpointRow[]
  >([]);
  const [serviceEndpointSlicesLoading, setServiceEndpointSlicesLoading] =
    useState(false);
  const [serviceEndpointSlicesError, setServiceEndpointSlicesError] =
    useState("");
  const [namespaceQuotas, setNamespaceQuotas] = useState<
    Record<string, unknown>[]
  >([]);
  const [namespaceQuotasLoading, setNamespaceQuotasLoading] = useState(false);
  const [namespaceQuotasError, setNamespaceQuotasError] = useState("");
  const [namespaceLimitRanges, setNamespaceLimitRanges] = useState<
    Record<string, unknown>[]
  >([]);
  const [namespaceLimitRangesLoading, setNamespaceLimitRangesLoading] =
    useState(false);
  const [namespaceLimitRangesError, setNamespaceLimitRangesError] =
    useState("");
  const [nodePods, setNodePods] = useState<K8sResourceRow[]>([]);
  const [nodePodsLoading, setNodePodsLoading] = useState(false);
  const [nodePodsError, setNodePodsError] = useState("");
  useEffect(() => {
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
    const selector = cleanedDetail ? workloadLabelSelector(cleanedDetail) : "";
    if (
      !cleanedDetail ||
      !item.namespace ||
      !selector ||
      !isOwnedPodResource(activeResource.id, text(cleanedDetail.kind))
    ) {
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
          setOwnedPodsError(
            err instanceof Error ? err.message : "Failed to load owned Pods",
          );
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
          setOwnedJobs(
            response.items.filter((row) =>
              hasOwner(
                row,
                "CronJob",
                item.name,
                text(record(cleanedDetail.metadata).uid),
              ),
            ),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setOwnedJobs([]);
          setOwnedJobsError(
            err instanceof Error ? err.message : "Failed to load owned Jobs",
          );
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
          setRevisionHistoryError(
            err instanceof Error
              ? err.message
              : "Failed to load revision history",
          );
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
        const details = await Promise.all(
          matching.map((row) =>
            api.resourceDetail(
              clusterId,
              "endpoints",
              item.namespace ?? "",
              row.name,
            ),
          ),
        );
        if (!cancelled) setServiceEndpoints(details.map(serviceEndpointRow));
      })
      .catch((err) => {
        if (!cancelled) {
          setServiceEndpoints([]);
          setServiceEndpointsError(
            err instanceof Error
              ? err.message
              : "Failed to load Service endpoints",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setServiceEndpointsLoading(false);
      });
    void api
      .resources(
        clusterId,
        "endpointslices",
        [item.namespace],
        `kubernetes.io/service-name=${item.name}`,
      )
      .then(async (response) => {
        const details = await Promise.all(
          response.items.map((row) =>
            api.resourceDetail(
              clusterId,
              "endpointslices",
              item.namespace ?? "",
              row.name,
            ),
          ),
        );
        if (!cancelled)
          setServiceEndpointSlices(details.map(serviceEndpointSliceRow));
      })
      .catch((err) => {
        if (!cancelled) {
          setServiceEndpointSlices([]);
          setServiceEndpointSlicesError(
            err instanceof Error
              ? err.message
              : "Failed to load Service endpoint slices",
          );
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
        const details = await Promise.all(
          response.items.map((row) =>
            api.resourceDetail(
              clusterId,
              "resourcequotas",
              item.name,
              row.name,
            ),
          ),
        );
        if (!cancelled) setNamespaceQuotas(details);
      })
      .catch((err) => {
        if (!cancelled) {
          setNamespaceQuotas([]);
          setNamespaceQuotasError(
            err instanceof Error
              ? err.message
              : "Failed to load ResourceQuotas",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setNamespaceQuotasLoading(false);
      });
    void api
      .resources(clusterId, "limitranges", [item.name])
      .then(async (response) => {
        const details = await Promise.all(
          response.items.map((row) =>
            api.resourceDetail(clusterId, "limitranges", item.name, row.name),
          ),
        );
        if (!cancelled) setNamespaceLimitRanges(details);
      })
      .catch((err) => {
        if (!cancelled) {
          setNamespaceLimitRanges([]);
          setNamespaceLimitRangesError(
            err instanceof Error ? err.message : "Failed to load LimitRanges",
          );
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
      .resources(
        clusterId,
        "pods",
        [],
        "",
        `spec.nodeName=${item.name},status.phase!=Succeeded,status.phase!=Failed`,
      )
      .then((response) => {
        if (!cancelled) setNodePods(response.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setNodePods([]);
          setNodePodsError(
            err instanceof Error ? err.message : "Failed to load node Pods",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setNodePodsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeResource.id, cleanedDetail, clusterId, item.name]);

  return {
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
  };
}
