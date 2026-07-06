// Pure helpers and shared row types for the resource detail/list views.
// Extracted from resource-list.tsx so the logic can be unit-tested in
// isolation and the page file stays focused on rendering.
import { load, YAMLException } from "js-yaml";
import { api, ApiError } from "./api";
import type {
  AccessReviewRequest,
  DiscoveredResource,
  GVRDescriptor,
  K8sResourceRow,
  NodeDrainResponse
} from "./api";
import { resourceConfigs } from "./resources";
import { formatAge, record, text } from "./utils";

export type ActiveResource = {
  id: string;
  label: string;
  namespaced: boolean;
  apiVersion: string;
  watchDescriptor: GVRDescriptor;
};

export type ServiceEndpointRow = {
  name: string;
  addresses: string[];
  ports: string[];
  addressType?: string;
  age: string;
};

export type DiffRow = {
  type: "same" | "add" | "remove";
  line: string;
};

export function createTemplate(resource: ActiveResource, preferredNamespace?: string) {
  const apiVersion = resource.apiVersion || "v1";
  const kind = defaultKindForResource(resource.id, resource.watchDescriptor.kind || resource.label);
  const namespace = resource.namespaced ? `\n  namespace: ${preferredNamespace || "default"}` : "";
  return `apiVersion: ${apiVersion}
kind: ${kind}
metadata:
  name: example-${resource.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}${namespace}
`;
}

export function defaultKindForResource(id: string, label: string) {
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

export function accessReviewForResource(gvr: GVRDescriptor, verb: string, namespace?: string, name?: string, subresource?: string): AccessReviewRequest {
  return {
    verb,
    group: gvr.group,
    resource: gvr.resource,
    namespace,
    name,
    subresource
  };
}

export function resourceUnavailableMessage(resource: ActiveResource) {
  const group = resource.watchDescriptor.group || "core";
  return `This cluster does not serve ${group}/${resource.watchDescriptor.version}/${resource.watchDescriptor.resource}. Open API Resources to browse the resources discovered on this cluster.`;
}

export function isConfiguredResource(resource: DiscoveredResource) {
  return resourceConfigs.some(
    (config) =>
      config.apiGroup === resource.group &&
      config.version === resource.version &&
      config.resource === resource.resource
  );
}

export function formatNodeDrainMessage(result: NodeDrainResponse) {
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

export function isPositiveActionMessage(message: string) {
  if (!message) return false;
  if (message.includes("failed") || message.includes("Failed")) return false;
  return message.startsWith("Scaled") || message.startsWith("Node cordoned") || message.startsWith("Node uncordoned") || message.startsWith("Node drained");
}

export type SplitDiffRow = {
  before: string;
  after: string;
  beforeType: "same" | "remove" | "blank";
  afterType: "same" | "add" | "blank";
};

export function buildSplitDiff(rows: DiffRow[]): SplitDiffRow[] {
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

export type ConditionRow = {
  type: string;
  status: string;
  reason: string;
  message: string;
  age: string;
};

export type RevisionRow = {
  revision: number;
  createdAt: string;
  age: string;
  images: string[];
  current: boolean;
};

export type ContainerRow = {
  name: string;
  image: string;
  pullPolicy: string;
  ports: string;
  requests: string;
  limits: string;
};

export type ServicePortRow = {
  name: string;
  protocol: string;
  port: number;
  targetPort: string;
};

export function servicePortRows(detail: Record<string, unknown>): ServicePortRow[] {
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

export function webhookClientSummary(clientConfig: Record<string, unknown>) {
  const url = text(clientConfig.url);
  if (url) return url;
  const service = record(clientConfig.service);
  const namespace = text(service.namespace);
  const name = text(service.name);
  const path = text(service.path);
  if (!namespace && !name) return "-";
  return `${namespace || "default"}/${name || "-"}${path ? `:${path}` : ""}`;
}

export function serviceEndpointRow(detail: Record<string, unknown>): ServiceEndpointRow {
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
    age: formatAge(text(metadata.creationTimestamp))
  };
}

export function serviceEndpointSliceRow(detail: Record<string, unknown>): ServiceEndpointRow {
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
    age: formatAge(text(metadata.creationTimestamp))
  };
}

export function ingressRuleRows(detail: Record<string, unknown>) {
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

export function gatewayParentRefRows(detail: Record<string, unknown>) {
  return arrayRecords(record(detail.spec).parentRefs).map((ref) => [
    text(ref.kind) || "Gateway",
    text(ref.name) || "-",
    text(ref.namespace) || text(record(detail.metadata).namespace) || "-",
    text(ref.sectionName) || "-"
  ]);
}

export function gatewayTargetRefRows(value: unknown) {
  return arrayRecords(value).map((ref) => [
    text(ref.group) || "-",
    text(ref.kind) || "Service",
    text(ref.name) || "-",
    text(ref.sectionName) || "-"
  ]);
}

export function gatewayRouteRuleRows(detail: Record<string, unknown>, resourceId: string) {
  return arrayRecords(record(detail.spec).rules).map((rule, index) => [
    text(rule.name) || `rule-${index + 1}`,
    gatewayMatchesSummary(arrayRecords(rule.matches), resourceId),
    gatewayBackendRefsSummary(arrayRecords(rule.backendRefs)),
    arrayRecords(rule.filters).map((filter) => text(filter.type)).filter(Boolean).join(", ") || "-"
  ]);
}

export function gatewayMatchesSummary(matches: Record<string, unknown>[], resourceId: string) {
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

export function gatewayBackendRefsSummary(refs: Record<string, unknown>[]) {
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

export function ingressBackendSummary(backend: Record<string, unknown>) {
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

export function ingressClassParametersSummary(parameters: Record<string, unknown>) {
  if (Object.keys(parameters).length === 0) return "";
  return [text(parameters.apiGroup), text(parameters.kind), text(parameters.namespace), text(parameters.name), text(parameters.scope)].filter(Boolean).join(" / ");
}

export function hpaMetricName(metric: Record<string, unknown>) {
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

export function hpaMetricTarget(metric: Record<string, unknown>) {
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

export function ingressPorts(detail: Record<string, unknown>) {
  const ports = new Set<string>();
  for (const row of ingressRuleRows(detail)) {
    const parts = row.backend.split(":");
    if (parts[1]) ports.add(parts[1]);
  }
  if (arrayRecords(record(detail.spec).tls).length > 0) ports.add("443");
  return [...ports].sort((a, b) => a.localeCompare(b));
}

export function namedRefs(value: unknown) {
  return arrayRecords(value).map((item) => text(item.name)).filter(Boolean);
}

export function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.map((item) => record(item)) : [];
}

export function isWorkloadResource(resourceId: string, kind: string) {
  return ["deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs", "pods"].includes(resourceId) ||
    ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "Pod"].includes(kind);
}

export function isOwnedPodResource(resourceId: string, kind: string) {
  return ["deployments", "statefulsets", "daemonsets", "replicasets", "jobs"].includes(resourceId) ||
    ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"].includes(kind);
}

export function hasOwner(row: K8sResourceRow, kind: string, name: string, uid = "") {
  return row.ownerReferences?.some((owner) => owner.kind === kind && (uid ? owner.uid === uid : owner.name === name)) ?? false;
}

export function supportsRevisionHistory(kind: string) {
  return ["Deployment", "DaemonSet", "StatefulSet"].includes(kind);
}

export async function loadRevisionHistory(clusterId: string, namespace: string, name: string, detail: Record<string, unknown>) {
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
          age: formatAge(text(metadata.creationTimestamp)),
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
    // "controllerrevisions" (apps/v1) is intentionally not in resourceConfigs
    // (it has no user-facing list page); it is served by the backend's
    // resourceDefinitions map and fetched here only to build revision history.
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
          age: formatAge(text(record(item.metadata).creationTimestamp)),
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

export function markLatestCurrent(rows: RevisionRow[]) {
  if (rows.length === 0) return rows;
  if (rows.some((row) => row.current)) return rows;
  return rows.map((row, index) => ({ ...row, current: index === 0 }));
}

export function podTemplateImages(template: Record<string, unknown>) {
  const spec = record(template.spec);
  const containers = Array.isArray(spec.containers) ? spec.containers : [];
  return containers.map((item) => text(record(item).image)).filter(Boolean);
}

export function workloadLabelSelector(detail: Record<string, unknown>) {
  const matchLabels = stringRecord(record(record(detail.spec).selector).matchLabels);
  return Object.entries(matchLabels)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

export function workloadStrategyValue(spec: Record<string, unknown>) {
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

export function workloadReplicaRows(kind: string, spec: Record<string, unknown>, status: Record<string, unknown>): Array<[string, string]> {
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

export function workloadConditionRows(status: Record<string, unknown>): ConditionRow[] {
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  return conditions.map((item) => {
    const condition = record(item);
    const timestamp = text(condition.lastTransitionTime) || text(condition.lastProbeTime);
    return {
      type: text(condition.type),
      status: text(condition.status),
      reason: text(condition.reason),
      message: text(condition.message),
      age: formatAge(timestamp)
    };
  });
}

export function workloadContainerRows(detail: Record<string, unknown>, field: "containers" | "initContainers" = "containers"): ContainerRow[] {
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

export function containerPorts(container: Record<string, unknown>) {
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

export function resourceMapSummary(values: Record<string, unknown>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${summaryValue(value)}`)
    .join(", ");
}

export function stripManagedFields(input: Record<string, unknown>) {
  const metadata = record(input.metadata);
  if (!("managedFields" in metadata)) return input;
  const rest = { ...metadata };
  delete rest.managedFields;
  return { ...input, metadata: rest };
}

export function stringRecord(value: unknown): Record<string, string> {
  const input = record(value);
  return Object.fromEntries(Object.entries(input).map(([key, val]) => [key, summaryValue(val)]));
}

export function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => summaryValue(item)).filter(Boolean);
}

export function objectSummaryRows(value: Record<string, unknown>, limit: number) {
  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && item !== "")
    .slice(0, limit)
    .map(([key, item]) => [key, summaryValue(item)]);
}

export function summaryValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function isSecretResource(item: K8sResourceRow, activeResource: ActiveResource) {
  return (
    item.kind.toLowerCase() === "secret" ||
    activeResource.id === "secrets" ||
    activeResource.watchDescriptor.resource === "secrets"
  );
}

export function supportsScale(gvr: GVRDescriptor) {
  return gvr.group === "apps" && gvr.version === "v1" && ["deployments", "statefulsets", "replicasets"].includes(gvr.resource);
}

export function isApplyConflictMessage(message: string) {
  const value = message.toLowerCase();
  return value.includes("conflict") || value.includes("apply conflict") || value.includes("field manager");
}

export function isApplyConflictError(err: unknown, message: string) {
  return (err instanceof ApiError && err.status === 409) || isApplyConflictMessage(message);
}

export function isPositiveApplyMessage(message: string) {
  return ["passed", "successfully", "Refreshed", "Restored"].some((value) => message.includes(value));
}

export function validateYamlSyntax(value: string) {
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

export function buildLineDiff(before: string, after: string): DiffRow[] {
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

export function sameResourceRow(a: K8sResourceRow, b: K8sResourceRow) {
  return (
    a.kind === b.kind &&
    a.apiVersion === b.apiVersion &&
    a.status === b.status &&
    a.age === b.age
  );
}

export function resourceRowKey(item: K8sResourceRow) {
  return `${item.namespace ?? ""}/${item.name}`;
}

export function resourceRowFromObject(object: Record<string, unknown>): K8sResourceRow | null {
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
    age: formatAge(creationTimestamp),
    ownerReferences
  };
}

export function resourceStatusFromObject(object: Record<string, unknown>) {
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
