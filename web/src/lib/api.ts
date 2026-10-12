export const DISPLAY_PALETTE = ["blue", "violet", "emerald", "amber", "rose", "cyan", "fuchsia", "indigo"] as const;
export type DisplayColor = (typeof DISPLAY_PALETTE)[number];

export type ClusterLink = {
  label: string;
  url: string;
};

export type Cluster = {
  id: string;
  name: string;
  context: string;
  server: string;
  source: "system" | "managed";
  reachable: boolean;
  status?: "reachable" | "degraded" | "unreachable";
  version?: string;
  error?: string;
  displayColor: DisplayColor;
  displayInitials: string;
  links: ClusterLink[];
};

export type KubeconfigContextPreview = {
  id: string;
  name: string;
  cluster: string;
  user?: string;
  server: string;
  current: boolean;
  alreadyExists: boolean;
};

export type KubeconfigPreviewResponse = {
  contexts: KubeconfigContextPreview[];
};

export type Dashboard = {
  nodeCount: number;
  podCount: number;
  namespaceCount: number;
  serverVersion: string;
  conditions: Record<string, number>;
};

export type WorkloadCounts = {
  healthy: number;
  degraded: number;
  failing: number;
  succeeded?: number;
  total: number;
};

export type FailingWorkloadEntry = {
  kind: string;
  namespace: string;
  name: string;
  reason: string;
};

export type WorkloadsOverview = {
  pods: WorkloadCounts;
  deployments: WorkloadCounts;
  statefulsets: WorkloadCounts;
  daemonsets: WorkloadCounts;
  jobs: WorkloadCounts;
  failing: FailingWorkloadEntry[];
};

export type TopologyNode = {
  id: string;
  kind: string;
  name: string;
  namespace?: string;
  status?: string;
};

export type TopologyEdge = {
  from: string;
  to: string;
  kind: "owns" | "selects" | "mounts" | "uses" | "routes" | "scales";
};

export type TopologyGraph = {
  namespace: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  warnings?: string[];
};

export type PromTarget = {
  namespace: string;
  service: string;
  port: number;
  source: string;
};

export type PromDetection = {
  available: boolean;
  target?: PromTarget;
  reason?: string;
  checkedAt: string;
};

export type PromRangeResponse = {
  status: "success" | "error";
  data?: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      values: Array<[number, string]>;
    }>;
  };
  error?: string;
};

export type Pod = {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  age: string;
  node: string;
  ready: string;
  ip: string;
};

export type Namespace = {
  name: string;
  status: string;
  age: string;
};

export type SecretReveal = {
  key: string;
  value?: string;
  base64: string;
  binary: boolean;
};

export type ClusterEvent = {
  name: string;
  namespace?: string;
  type: string;
  reason: string;
  note: string;
  action: string;
  regardingKind: string;
  regardingName: string;
  regardingNamespace?: string;
  reportingController: string;
  count: number;
  eventTime: string;
  firstTimestamp: string;
  lastTimestamp: string;
  age: string;
};

export type MetricsRow = {
  name: string;
  namespace?: string;
  cpu: number;
  memory: number;
  cpuPercent?: number;
  memoryPercent?: number;
  capacityCPU?: number;
  capacityMemory?: number;
  window?: string;
  timestamp?: string;
  containerCount?: number;
  regardingResource: string;
};

export type ClusterMetrics = {
  available: boolean;
  error?: string;
  nodeCount?: number;
  podCount?: number;
  totalCPU?: number;
  totalMemory?: number;
  totalCapacityCPU?: number;
  totalCapacityMemory?: number;
  cpuPercent?: number;
  memoryPercent?: number;
  nodes: MetricsRow[];
  pods: MetricsRow[];
};

export type PortForward = {
	 browserUrl?: string;
  id: string;
  clusterId: string;
  namespace: string;
  pod: string;
  resourceKind: "pod" | "service";
  resourceName: string;
  localPort: number;
  remotePort: number;
  url: string;
  createdAt: string;
  expiresAt?: string;
  error?: string;
};

export type PodContainer = {
  name: string;
  image: string;
  ready: boolean;
  restarts: number;
  state: string;
  ports?: number[];
  requests?: Record<string, string>;
  limits?: Record<string, string>;
  pullPolicy?: string;
};

export type PodCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
};

export type PodVolume = {
  name: string;
  type: string;
};

export type PodToleration = {
  key?: string;
  value?: string;
  operator?: string;
  effect?: string;
  tolerationSeconds?: number;
};

export type PodDetail = Pod & {
  uid?: string;
  createdAt?: string;
  podIP: string;
  podIPs?: string[];
  hostIP: string;
  hostIPs?: string[];
  serviceAccountName: string;
  qosClass?: string;
  priority?: number;
  labels: Record<string, string> | null;
  annotations: Record<string, string> | null;
  ownerReferences?: K8sOwnerReference[];
  containers: PodContainer[];
  initContainers?: PodContainer[];
  volumes?: PodVolume[];
  tolerations?: PodToleration[];
  conditions: PodCondition[];
};

export type K8sResourceRow = {
  name: string;
  namespace?: string;
  kind: string;
  apiVersion: string;
  status?: string;
  age: string;
  ownerReferences?: K8sOwnerReference[];
};

export type K8sOwnerReference = {
  apiVersion: string;
  kind: string;
  name: string;
  uid?: string;
  controller?: boolean;
};

export type K8sResourceList = {
  apiVersion?: string;
  resource: string;
  label: string;
  namespaced: boolean;
  items: K8sResourceRow[];
};

export type DiscoveredResource = {
  groupVersion: string;
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespaced: boolean;
  verbs: string[];
};

export type GVRDescriptor = Pick<DiscoveredResource, "group" | "version" | "resource" | "kind" | "namespaced">;

export type LogFrame = {
  type: "line" | "error" | "end";
  message?: string;
  timestamp?: string;
};

export type ExecFrame = {
  type: "stdout" | "stderr" | "error" | "end";
  message?: string;
};

export type WatchFrame = {
  type: "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK" | "ERROR" | "RESET";
  object?: Record<string, unknown>;
  message?: string;
};

export type ApplyResult = {
  apiGroup: string;
  apiVersion: string;
  kind: string;
  resource: string;
  namespace?: string;
  name: string;
  dryRun: boolean;
};

export type ApplyResponse = {
  dryRun: boolean;
  items: ApplyResult[];
};

export type AccessReviewRequest = {
  verb: string;
  group: string;
  resource: string;
  subresource?: string;
  namespace?: string;
  name?: string;
};

export type AccessReviewResponse = {
  allowed: boolean;
  denied: boolean;
  reason?: string;
  evaluationError?: string;
};

export type NodeDrainPodResult = {
  namespace: string;
  name: string;
  reason?: string;
  error?: string;
};

export type SearchHit = {
  kind: string;
  apiVersion: string;
  resource: string;
  namespace?: string;
  name: string;
};

export type HelmReleaseSummary = {
  name: string;
  namespace: string;
  chart: string;
  version: string;
  appVersion?: string;
  revision: number;
  status: string;
  updated: string;
};

export type HelmReleaseDetail = HelmReleaseSummary & {
  notes?: string;
  manifest?: string;
  values?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type NodeDrainResponse = {
  nodeCordoned: boolean;
  nodeWasCordoned: boolean;
  evicted: NodeDrainPodResult[];
  skipped: NodeDrainPodResult[];
  errors: NodeDrainPodResult[];
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("X-Astronomer-Lite", "1");
  const response = await fetch(input, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    if (response.status === 401 && body.error === "sign in required") window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(response.status, body.error ?? response.statusText);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  clusters: () => request<Cluster[]>("/api/clusters"),
  previewKubeconfig: (yaml: string) =>
    request<KubeconfigPreviewResponse>("/api/clusters/preview", {
      method: "POST",
      headers: { "Content-Type": "application/yaml" },
      body: yaml
    }),
  addKubeconfig: (yaml: string, contexts: string[] = []) => {
    const params = new URLSearchParams();
    for (const context of contexts) params.append("context", context);
    const query = params.toString();
    return request<Cluster[]>(`/api/clusters${query ? `?${query}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/yaml" },
      body: yaml
    });
  },
  removeCluster: (id: string) => request<void>(`/api/clusters/${id}`, { method: "DELETE" }),
  updateClusterDisplay: (id: string, payload: { color?: string; initials?: string }) =>
    request<Cluster>(`/api/clusters/${id}/display`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  updateClusterLinks: (id: string, links: ClusterLink[]) =>
    request<Cluster>(`/api/clusters/${id}/links`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ links })
    }),
  dashboard: (id: string) => request<Dashboard>(`/api/clusters/${id}/dashboard`),
  workloadsOverview: (id: string) => request<WorkloadsOverview>(`/api/clusters/${id}/workloads-overview`),
  topology: (id: string, namespace: string) =>
    request<TopologyGraph>(`/api/clusters/${id}/topology?namespace=${encodeURIComponent(namespace)}`),
  promDetect: (id: string) =>
    request<PromDetection>(`/api/clusters/${id}/prom/detect`),
  promQueryRange: (id: string, query: string, start?: string, end?: string, step?: string) => {
    const params = new URLSearchParams({ query });
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (step) params.set("step", step);
    return request<PromRangeResponse>(`/api/clusters/${id}/prom/query_range?${params.toString()}`);
  },
  canI: (id: string, review: AccessReviewRequest) =>
    request<AccessReviewResponse>(`/api/clusters/${id}/can-i`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(review)
    }),
  metrics: (id: string) => request<ClusterMetrics>(`/api/clusters/${id}/metrics`),
  portForwards: (id: string) => request<PortForward[]>(`/api/clusters/${id}/portforwards`),
  startPortForward: (id: string, namespace: string, pod: string, remotePort: number, localPort = 0) =>
    request<PortForward>(`/api/clusters/${id}/portforwards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace, pod, remotePort, localPort })
    }),
  startServicePortForward: (id: string, namespace: string, service: string, remotePort: number, localPort = 0) =>
    request<PortForward>(`/api/clusters/${id}/portforwards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace, resourceKind: "service", resourceName: service, remotePort, localPort })
    }),
  stopPortForward: (id: string, sessionId: string) =>
    request<void>(`/api/clusters/${id}/portforwards/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  drainNode: (id: string, name: string, options: { force: boolean; deleteEmptyDirData: boolean }) =>
    request<NodeDrainResponse>(`/api/clusters/${id}/nodes/${encodeURIComponent(name)}/drain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options)
    }),
  namespaces: (id: string) => request<Namespace[]>(`/api/clusters/${id}/namespaces`),
  revealSecretKey: (id: string, namespace: string, name: string, key: string) =>
    request<SecretReveal>(
      `/api/clusters/${id}/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/reveal/${encodeURIComponent(key)}`
    ),
  events: (id: string, namespaces: string[] = []) => {
    const params = new URLSearchParams();
    for (const namespace of namespaces) params.append("namespace", namespace);
    const query = params.toString();
    return request<ClusterEvent[]>(`/api/clusters/${id}/events${query ? `?${query}` : ""}`);
  },
  pods: (id: string, namespaces: string[] = []) => {
    const params = new URLSearchParams();
    for (const namespace of namespaces) params.append("namespace", namespace);
    const query = params.toString();
    return request<Pod[]>(`/api/clusters/${id}/pods${query ? `?${query}` : ""}`);
  },
  podDetail: (id: string, namespace: string, name: string) =>
    request<PodDetail>(
      `/api/clusters/${id}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
    ),
  podLogsUrl: (
    id: string,
    namespace: string,
    name: string,
    container: string,
    tailLines: number,
    follow: boolean,
    options: { sinceTime?: string; timestamps?: boolean } = {}
  ) => {
    const params = new URLSearchParams({
      ns: namespace,
      pod: name,
      tailLines: String(tailLines),
      follow: String(follow)
    });
    if (container) params.set("container", container);
    if (options.sinceTime) params.set("sinceTime", options.sinceTime);
    if (options.timestamps) params.set("timestamps", "true");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/clusters/${id}/ws/logs?${params.toString()}`;
  },
  podExecUrl: (id: string, namespace: string, name: string, container: string, command: string[]) => {
    const params = new URLSearchParams({
      ns: namespace,
      pod: name
    });
    if (container) params.set("container", container);
    for (const part of command) params.append("command", part);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/clusters/${id}/ws/exec?${params.toString()}`;
  },
  podAttachUrl: (id: string, namespace: string, name: string, container: string) => {
    const params = new URLSearchParams({
      ns: namespace,
      pod: name
    });
    if (container) params.set("container", container);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/clusters/${id}/ws/attach?${params.toString()}`;
  },
  watchUrl: (id: string, gvr: GVRDescriptor, namespaces: string[] = []) => {
    const params = gvrParams(gvr);
    for (const namespace of namespaces) params.append("namespace", namespace);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/clusters/${id}/ws/watch?${params.toString()}`;
  },
  resources: (id: string, resource: string, namespaces: string[] = [], labelSelector = "", fieldSelector = "") => {
    const params = new URLSearchParams();
    for (const namespace of namespaces) params.append("namespace", namespace);
    if (labelSelector) params.set("labelSelector", labelSelector);
    if (fieldSelector) params.set("fieldSelector", fieldSelector);
    const query = params.toString();
    return request<K8sResourceList>(`/api/clusters/${id}/resources/${resource}${query ? `?${query}` : ""}`);
  },
  // Cluster-scoped resources have no namespace; the server contract encodes an
  // empty namespace as the literal path sentinel "_" (see the resources/gvr
  // handlers in server/internal/server). Keep this consistent on both sides.
  resourceDetail: (id: string, resource: string, namespace: string, name: string) =>
    request<Record<string, unknown>>(
      `/api/clusters/${id}/resources/${resource}/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}`
    ),
  applyResource: (id: string, resource: string, namespace: string, name: string, yaml: string, dryRun = false, force = false) => {
    const params = new URLSearchParams();
    if (dryRun) params.set("dryRun", "true");
    if (force) params.set("force", "true");
    const query = params.toString();
    return request<Record<string, unknown>>(
      `/api/clusters/${id}/resources/${resource}/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}${query ? `?${query}` : ""}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/yaml" },
        body: yaml
      }
    );
  },
  deleteResource: (id: string, resource: string, namespace: string, name: string) =>
    request<void>(
      `/api/clusters/${id}/resources/${resource}/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}`,
      { method: "DELETE" }
    ),
  scaleResource: (id: string, resource: string, namespace: string, name: string, replicas: number) =>
    request<Record<string, unknown>>(
      `/api/clusters/${id}/resources/${resource}/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}/scale`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replicas })
      }
    ),
  rollbackResource: (id: string, resource: string, namespace: string, name: string, revision: number) =>
    request<{ revision: number; name: string }>(
      `/api/clusters/${id}/resources/${resource}/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}/rollback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision })
      }
    ),
  discovery: (id: string) => request<DiscoveredResource[]>(`/api/clusters/${id}/discovery`),
  openapi: (id: string) => request<Record<string, unknown>>(`/api/clusters/${id}/openapi`),
  search: (id: string, query: string) =>
    request<SearchHit[]>(`/api/clusters/${id}/search?q=${encodeURIComponent(query)}`),
  helmReleases: (id: string, namespace = "") =>
    request<HelmReleaseSummary[]>(
      `/api/clusters/${id}/helm/releases${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`
    ),
  helmRelease: (id: string, namespace: string, name: string) =>
    request<HelmReleaseDetail>(
      `/api/clusters/${id}/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
    ),
  helmReleaseHistory: (id: string, namespace: string, name: string) =>
    request<HelmReleaseSummary[]>(
      `/api/clusters/${id}/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/history`
    ),
  helmRollback: (id: string, namespace: string, name: string, revision: number) =>
    request<{ name: string; revision: number }>(
      `/api/clusters/${id}/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/rollback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision })
      }
    ),
  helmUninstall: (id: string, namespace: string, name: string) =>
    request<{ name: string; status?: string }>(
      `/api/clusters/${id}/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
      { method: "DELETE" }
    ),
  applyManifests: (id: string, yaml: string, dryRun = false, force = false) => {
    const params = new URLSearchParams();
    if (dryRun) params.set("dryRun", "true");
    if (force) params.set("force", "true");
    const query = params.toString();
    return request<ApplyResponse>(`/api/clusters/${id}/apply${query ? `?${query}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/yaml" },
      body: yaml
    });
  },
  gvrResources: (id: string, gvr: GVRDescriptor, namespaces: string[] = []) => {
    const params = gvrParams(gvr);
    for (const namespace of namespaces) params.append("namespace", namespace);
    return request<K8sResourceList>(`/api/clusters/${id}/gvr?${params.toString()}`);
  },
  gvrResourceDetail: (id: string, gvr: GVRDescriptor, namespace: string, name: string) => {
    const params = gvrParams(gvr);
    return request<Record<string, unknown>>(
      `/api/clusters/${id}/gvr/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}?${params.toString()}`
    );
  },
  applyGVRResource: (id: string, gvr: GVRDescriptor, namespace: string, name: string, yaml: string, dryRun = false, force = false) => {
    const params = gvrParams(gvr);
    if (dryRun) params.set("dryRun", "true");
    if (force) params.set("force", "true");
    return request<Record<string, unknown>>(
      `/api/clusters/${id}/gvr/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}?${params.toString()}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/yaml" },
        body: yaml
      }
    );
  },
  deleteGVRResource: (id: string, gvr: GVRDescriptor, namespace: string, name: string) => {
    const params = gvrParams(gvr);
    return request<void>(
      `/api/clusters/${id}/gvr/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}?${params.toString()}`,
      { method: "DELETE" }
    );
  },
  scaleGVRResource: (id: string, gvr: GVRDescriptor, namespace: string, name: string, replicas: number) => {
    const params = gvrParams(gvr);
    return request<Record<string, unknown>>(
      `/api/clusters/${id}/gvr/${encodeURIComponent(namespace || "_")}/${encodeURIComponent(name)}/scale?${params.toString()}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replicas })
      }
    );
  }
};

function gvrParams(gvr: GVRDescriptor) {
  const params = new URLSearchParams();
  params.set("group", gvr.group);
  params.set("version", gvr.version);
  params.set("resource", gvr.resource);
  params.set("kind", gvr.kind);
  params.set("namespaced", String(gvr.namespaced));
  return params;
}
