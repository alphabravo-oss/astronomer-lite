import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import type { ActiveResource } from "./resource-detail";
import {
  accessReviewForResource,
  arrayRecords,
  buildLineDiff,
  buildSplitDiff,
  containerPorts,
  createTemplate,
  defaultKindForResource,
  formatNodeDrainMessage,
  gatewayBackendRefsSummary,
  gatewayMatchesSummary,
  gatewayParentRefRows,
  gatewayRouteRuleRows,
  gatewayTargetRefRows,
  hasOwner,
  isApplyConflictError,
  podTemplateImages,
  workloadLabelSelector,
  hpaMetricName,
  hpaMetricTarget,
  ingressBackendSummary,
  ingressClassParametersSummary,
  ingressPorts,
  ingressRuleRows,
  isApplyConflictMessage,
  isConfiguredResource,
  isOwnedPodResource,
  isPositiveActionMessage,
  isPositiveApplyMessage,
  isSecretResource,
  isWorkloadResource,
  markLatestCurrent,
  namedRefs,
  objectSummaryRows,
  resourceMapSummary,
  resourceRowFromObject,
  resourceRowKey,
  resourceStatusFromObject,
  resourceUnavailableMessage,
  sameResourceRow,
  serviceEndpointRow,
  serviceEndpointSliceRow,
  servicePortRows,
  stringList,
  stringRecord,
  stripManagedFields,
  summaryValue,
  supportsRevisionHistory,
  supportsScale,
  validateYamlSyntax,
  webhookClientSummary,
  workloadConditionRows,
  workloadContainerRows,
  workloadReplicaRows,
  workloadStrategyValue
} from "./resource-detail";
import type { K8sResourceRow } from "./api";

describe("primitive coercion", () => {
  it("summaryValue stringifies scalars, arrays, and objects", () => {
    expect(summaryValue(null)).toBe("");
    expect(summaryValue(undefined)).toBe("");
    expect(summaryValue("hi")).toBe("hi");
    expect(summaryValue(7)).toBe("7");
    expect(summaryValue(false)).toBe("false");
    expect(summaryValue([1, 2])).toBe("2 items");
    expect(summaryValue([1])).toBe("1 item");
    expect(summaryValue({ a: 1 })).toBe('{"a":1}');
  });

  it("stringRecord maps every value through summaryValue", () => {
    expect(stringRecord({ a: 1, b: "x", c: true })).toEqual({ a: "1", b: "x", c: "true" });
    expect(stringRecord("not an object")).toEqual({});
  });

  it("stringList drops falsy entries", () => {
    expect(stringList(["a", "", 2, null])).toEqual(["a", "2"]);
    expect(stringList("nope")).toEqual([]);
  });

  it("arrayRecords coerces each entry to a record", () => {
    expect(arrayRecords([{ a: 1 }, 5, [1]])).toEqual([{ a: 1 }, {}, {}]);
    expect(arrayRecords(null)).toEqual([]);
  });

  it("objectSummaryRows filters empties and respects the limit", () => {
    expect(objectSummaryRows({ a: 1, b: "", c: null, d: "x" }, 10)).toEqual([
      ["a", "1"],
      ["d", "x"]
    ]);
    expect(objectSummaryRows({ a: 1, b: 2, c: 3 }, 2)).toEqual([
      ["a", "1"],
      ["b", "2"]
    ]);
  });

  it("namedRefs collects non-empty names", () => {
    expect(namedRefs([{ name: "a" }, { name: "" }, { foo: 1 }])).toEqual(["a"]);
  });
});

describe("diffing", () => {
  it("buildLineDiff produces an LCS-aligned line diff", () => {
    expect(buildLineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { type: "same", line: "a" },
      { type: "remove", line: "b" },
      { type: "add", line: "x" },
      { type: "same", line: "c" }
    ]);
    expect(buildLineDiff("same", "same")).toEqual([]);
  });

  it("buildSplitDiff pairs removed and added rows side by side", () => {
    const rows = buildLineDiff("a\nb\nc", "a\nx\nc");
    expect(buildSplitDiff(rows)).toEqual([
      { before: "a", after: "a", beforeType: "same", afterType: "same" },
      { before: "b", after: "x", beforeType: "remove", afterType: "add" },
      { before: "c", after: "c", beforeType: "same", afterType: "same" }
    ]);
  });
});

describe("service / endpoint shaping", () => {
  it("servicePortRows skips ports without a positive port number", () => {
    expect(
      servicePortRows({ spec: { ports: [{ port: 80, name: "http", protocol: "TCP", targetPort: 8080 }, { port: 0 }, { name: "bad" }] } })
    ).toEqual([{ name: "http", protocol: "TCP", port: 80, targetPort: "8080" }]);
  });

  it("serviceEndpointRow flattens subset addresses and ports", () => {
    expect(
      serviceEndpointRow({
        metadata: { name: "ep" },
        subsets: [{ addresses: [{ ip: "1.2.3.4", hostname: "h" }], ports: [{ name: "http", port: 80, protocol: "TCP" }] }]
      })
    ).toEqual({ name: "ep", addresses: ["1.2.3.4 h"], ports: ["http:80/TCP"], age: "" });
  });

  it("serviceEndpointSliceRow reads endpoints and the address type", () => {
    expect(
      serviceEndpointSliceRow({
        metadata: { name: "slice" },
        addressType: "IPv4",
        endpoints: [{ addresses: ["1.1.1.1"] }],
        ports: [{ name: "http", port: 443, protocol: "TCP" }]
      })
    ).toEqual({ name: "slice", addresses: ["1.1.1.1"], ports: ["http:443/TCP"], addressType: "IPv4", age: "" });
  });
});

describe("ingress / gateway / hpa", () => {
  it("ingressBackendSummary handles service and resource backends", () => {
    expect(ingressBackendSummary({ service: { name: "web", port: { number: 80 } } })).toBe("web:80");
    expect(ingressBackendSummary({ resource: { kind: "Bucket", name: "b" } })).toBe("Bucket:b");
    expect(ingressBackendSummary({})).toBe("");
  });

  it("ingressRuleRows and ingressPorts derive routing details", () => {
    const detail = {
      spec: {
        rules: [{ host: "x.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "web", port: { number: 80 } } } }] } }],
        tls: [{}]
      }
    };
    expect(ingressRuleRows(detail)).toEqual([{ host: "x.com", path: "/ Prefix", backend: "web:80" }]);
    expect(ingressPorts(detail)).toEqual(["443", "80"]);
  });

  it("ingressClassParametersSummary joins present fields", () => {
    expect(ingressClassParametersSummary({ apiGroup: "k8s.io", kind: "X", name: "n" })).toBe("k8s.io / X / n");
    expect(ingressClassParametersSummary({})).toBe("");
  });

  it("gateway summaries format refs", () => {
    expect(gatewayBackendRefsSummary([{ kind: "Service", name: "svc", port: 8080, weight: 1 }])).toBe("Service:svc:8080 weight 1");
    expect(gatewayBackendRefsSummary([])).toBe("-");
    expect(gatewayParentRefRows({ spec: { parentRefs: [{ kind: "Gateway", name: "gw", namespace: "ns", sectionName: "http" }] }, metadata: {} })).toEqual([
      ["Gateway", "gw", "ns", "http"]
    ]);
  });

  it("hpaMetricName and hpaMetricTarget read metric specs", () => {
    expect(hpaMetricName({ type: "Resource", resource: { name: "cpu" } })).toBe("cpu");
    expect(hpaMetricName({ type: "Pods", pods: { metric: { name: "qps" } } })).toBe("qps");
    expect(hpaMetricTarget({ type: "Resource", resource: { target: { type: "Utilization", averageUtilization: 80 } } })).toBe("Utilization / 80%");
  });
});

describe("workload shaping", () => {
  it("workloadReplicaRows summarises a Deployment", () => {
    expect(workloadReplicaRows("Deployment", { replicas: 3 }, { readyReplicas: 2, replicas: 3 })).toEqual([
      ["Desired", "3"],
      ["Ready", "2"],
      ["Total", "3"]
    ]);
  });

  it("workloadStrategyValue describes a rolling update", () => {
    expect(workloadStrategyValue({ strategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 1, maxSurge: "25%" } } })).toBe(
      "RollingUpdate, max unavailable 1, max surge 25%"
    );
  });

  it("workloadConditionRows maps conditions", () => {
    expect(workloadConditionRows({ conditions: [{ type: "Available", status: "True", reason: "R", message: "M", lastTransitionTime: "" }] })).toEqual([
      { type: "Available", status: "True", reason: "R", message: "M", age: "" }
    ]);
  });

  it("workloadContainerRows and containerPorts read the pod template", () => {
    const detail = {
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: "app",
                image: "nginx",
                imagePullPolicy: "IfNotPresent",
                ports: [{ name: "http", containerPort: 80, protocol: "TCP" }],
                resources: { requests: { cpu: "100m" }, limits: { memory: "128Mi" } }
              }
            ]
          }
        }
      }
    };
    expect(workloadContainerRows(detail)).toEqual([
      { name: "app", image: "nginx", pullPolicy: "IfNotPresent", ports: "http:80/TCP", requests: "cpu: 100m", limits: "memory: 128Mi" }
    ]);
    expect(containerPorts({ ports: [{ containerPort: 9090 }] })).toBe("9090/TCP");
  });

  it("resourceMapSummary joins resource quantities", () => {
    expect(resourceMapSummary({ cpu: "100m", memory: "128Mi" })).toBe("cpu: 100m, memory: 128Mi");
  });
});

describe("resource row mapping", () => {
  it("resourceStatusFromObject prefers phase, then replica readiness", () => {
    expect(resourceStatusFromObject({ status: { phase: "Running" } })).toBe("Running");
    expect(resourceStatusFromObject({ status: { readyReplicas: 2 }, spec: { replicas: 3 } })).toBe("2/3 ready");
    expect(resourceStatusFromObject({ status: { availableReplicas: 5 } })).toBe("5 available");
    expect(resourceStatusFromObject({ type: "Normal" })).toBe("Normal");
    expect(resourceStatusFromObject({})).toBe("");
  });

  it("resourceRowFromObject requires a name", () => {
    expect(resourceRowFromObject({ metadata: { name: "p", namespace: "ns", creationTimestamp: "" }, kind: "Pod", apiVersion: "v1", status: { phase: "Running" } })).toEqual({
      name: "p",
      namespace: "ns",
      kind: "Pod",
      apiVersion: "v1",
      status: "Running",
      age: "",
      ownerReferences: undefined
    });
    expect(resourceRowFromObject({ metadata: {} })).toBeNull();
  });

  it("resourceRowKey and sameResourceRow compare rows", () => {
    expect(resourceRowKey({ namespace: "ns", name: "n" } as K8sResourceRow)).toBe("ns/n");
    expect(resourceRowKey({ name: "n" } as K8sResourceRow)).toBe("/n");
    const base = { kind: "Pod", apiVersion: "v1", status: "Running", age: "1h" } as K8sResourceRow;
    expect(sameResourceRow(base, { ...base })).toBe(true);
    expect(sameResourceRow(base, { ...base, status: "Pending" })).toBe(false);
  });
});

describe("classification helpers", () => {
  it("isWorkloadResource matches by id or kind", () => {
    expect(isWorkloadResource("deployments", "")).toBe(true);
    expect(isWorkloadResource("foo", "Pod")).toBe(true);
    expect(isWorkloadResource("foo", "Bar")).toBe(false);
  });

  it("isOwnedPodResource excludes CronJobs", () => {
    expect(isOwnedPodResource("jobs", "")).toBe(true);
    expect(isOwnedPodResource("cronjobs", "CronJob")).toBe(false);
  });

  it("hasOwner matches by uid when given, otherwise by name", () => {
    const row = { ownerReferences: [{ kind: "Deployment", name: "d", uid: "u1" }] } as unknown as K8sResourceRow;
    expect(hasOwner(row, "Deployment", "d")).toBe(true);
    expect(hasOwner(row, "Deployment", "x", "u1")).toBe(true);
    expect(hasOwner(row, "ReplicaSet", "d")).toBe(false);
  });

  it("supportsRevisionHistory and supportsScale gate on kind/gvr", () => {
    expect(supportsRevisionHistory("Deployment")).toBe(true);
    expect(supportsRevisionHistory("Pod")).toBe(false);
    expect(supportsScale({ group: "apps", version: "v1", resource: "deployments", kind: "Deployment", namespaced: true })).toBe(true);
    expect(supportsScale({ group: "", version: "v1", resource: "pods", kind: "Pod", namespaced: true })).toBe(false);
  });

  it("isSecretResource matches by kind or active resource", () => {
    const secretRow = { kind: "Secret" } as K8sResourceRow;
    const configRow = { kind: "ConfigMap" } as K8sResourceRow;
    expect(isSecretResource(secretRow, { id: "x", watchDescriptor: { resource: "x" } } as ActiveResource)).toBe(true);
    expect(isSecretResource(configRow, { id: "secrets", watchDescriptor: { resource: "x" } } as ActiveResource)).toBe(true);
    expect(isSecretResource(configRow, { id: "x", watchDescriptor: { resource: "x" } } as ActiveResource)).toBe(false);
  });

  it("isConfiguredResource is false for an unknown GVR", () => {
    expect(isConfiguredResource({ group: "made.up", version: "v1", resource: "nope" } as never)).toBe(false);
  });
});

describe("messages and templates", () => {
  it("defaultKindForResource maps known ids and singularises the rest", () => {
    expect(defaultKindForResource("deployments", "")).toBe("Deployment");
    expect(defaultKindForResource("widgets", "Widgets")).toBe("Widget");
    expect(defaultKindForResource("foo", "Foo")).toBe("Foo");
  });

  it("createTemplate produces a minimal manifest", () => {
    const template = createTemplate(
      { id: "configmaps", label: "ConfigMaps", namespaced: true, apiVersion: "v1", watchDescriptor: { kind: "ConfigMap" } } as ActiveResource,
      "kube-system"
    );
    expect(template).toContain("apiVersion: v1");
    expect(template).toContain("kind: ConfigMap");
    expect(template).toContain("name: example-configmaps");
    expect(template).toContain("namespace: kube-system");
  });

  it("accessReviewForResource builds a review request", () => {
    expect(accessReviewForResource({ group: "apps", version: "v1", resource: "deployments", kind: "Deployment", namespaced: true }, "get", "ns", "name", "log")).toEqual({
      verb: "get",
      group: "apps",
      resource: "deployments",
      namespace: "ns",
      name: "name",
      subresource: "log"
    });
  });

  it("apply/action message classifiers read intent from text", () => {
    expect(isApplyConflictMessage("Apply conflict detected")).toBe(true);
    expect(isApplyConflictMessage("field manager xyz")).toBe(true);
    expect(isApplyConflictMessage("all good")).toBe(false);
    expect(isPositiveApplyMessage("Dry run passed")).toBe(true);
    expect(isPositiveApplyMessage("error")).toBe(false);
    expect(isPositiveActionMessage("Scaled to 3")).toBe(true);
    expect(isPositiveActionMessage("Scaling failed")).toBe(false);
    expect(isPositiveActionMessage("")).toBe(false);
  });

  it("validateYamlSyntax returns an error string only for invalid YAML", () => {
    expect(validateYamlSyntax("a: 1")).toBe("");
    expect(validateYamlSyntax("key: 'value")).toMatch(/^Invalid YAML/);
  });

  it("formatNodeDrainMessage summarises eviction results", () => {
    expect(formatNodeDrainMessage({ evicted: [{}, {}], skipped: [{}], errors: [] } as never)).toBe("Node drained: 2 evicted. 1 skipped");
    expect(formatNodeDrainMessage({ evicted: [], skipped: [], errors: [] } as never)).toBe("Node drained: 0 evicted. no Pods were running on the node");
    expect(formatNodeDrainMessage({ evicted: [], skipped: [], errors: [{ namespace: "ns", name: "p", error: "boom" }] } as never)).toBe(
      "Node drained: 0 evicted. 1 failed. ns/p: boom"
    );
  });

  it("resourceUnavailableMessage names the unserved GVR", () => {
    expect(resourceUnavailableMessage({ watchDescriptor: { group: "apps", version: "v1", resource: "deployments" } } as ActiveResource)).toContain(
      "apps/v1/deployments"
    );
    expect(resourceUnavailableMessage({ watchDescriptor: { group: "", version: "v1", resource: "pods" } } as ActiveResource)).toContain("core/v1/pods");
  });

  it("webhookClientSummary prefers url, then service ref", () => {
    expect(webhookClientSummary({ url: "https://x" })).toBe("https://x");
    expect(webhookClientSummary({ service: { namespace: "ns", name: "svc", path: "/validate" } })).toBe("ns/svc:/validate");
    expect(webhookClientSummary({})).toBe("-");
  });
});

describe("revision history", () => {
  it("markLatestCurrent flags the newest revision when none is current", () => {
    expect(markLatestCurrent([])).toEqual([]);
    expect(
      markLatestCurrent([
        { revision: 2, createdAt: "", age: "", images: [], current: false },
        { revision: 1, createdAt: "", age: "", images: [], current: false }
      ])
    ).toEqual([
      { revision: 2, createdAt: "", age: "", images: [], current: true },
      { revision: 1, createdAt: "", age: "", images: [], current: false }
    ]);
    const withCurrent = [
      { revision: 2, createdAt: "", age: "", images: [], current: false },
      { revision: 1, createdAt: "", age: "", images: [], current: true }
    ];
    expect(markLatestCurrent(withCurrent)).toBe(withCurrent);
  });
});

describe("stripManagedFields", () => {
  it("removes metadata.managedFields when present", () => {
    expect(stripManagedFields({ metadata: { name: "x", managedFields: [1] } })).toEqual({ metadata: { name: "x" } });
    const clean = { metadata: { name: "x" } };
    expect(stripManagedFields(clean)).toBe(clean);
  });
});

describe("gateway route helpers (P2-7)", () => {
  it("gatewayTargetRefRows maps refs with defaults", () => {
    expect(gatewayTargetRefRows([{ group: "g", kind: "K", name: "n", sectionName: "s" }, {}])).toEqual([
      ["g", "K", "n", "s"],
      ["-", "Service", "-", "-"]
    ]);
    expect(gatewayTargetRefRows(null)).toEqual([]);
  });

  it("gatewayMatchesSummary summarizes HTTP and gRPC matches", () => {
    expect(gatewayMatchesSummary([], "httproutes")).toBe("-");
    expect(
      gatewayMatchesSummary([{ path: { type: "PathPrefix", value: "/api" }, method: "GET", headers: [{}, {}], queryParams: [{}] }], "httproutes")
    ).toBe("GET, PathPrefix /api, 2 headers, 1 query params");
    expect(gatewayMatchesSummary([{ method: { service: "svc", method: "m" } }], "grpcroutes")).toBe("svc/m");
  });

  it("gatewayRouteRuleRows builds rule table rows", () => {
    expect(
      gatewayRouteRuleRows(
        {
          spec: {
            rules: [
              {
                name: "r1",
                matches: [{ path: { type: "Exact", value: "/x" } }],
                backendRefs: [{ kind: "Service", name: "b", port: 80 }],
                filters: [{ type: "RequestRedirect" }]
              }
            ]
          }
        },
        "httproutes"
      )
    ).toEqual([["r1", "Exact /x", "Service:b:80", "RequestRedirect"]]);
  });

  it("gatewayRouteRuleRows names unnamed rules by index", () => {
    const rows = gatewayRouteRuleRows({ spec: { rules: [{}] } }, "httproutes");
    expect(rows[0][0]).toBe("rule-1");
  });
});

describe("workload + apply helpers (P2-7)", () => {
  it("podTemplateImages collects non-empty container images", () => {
    expect(podTemplateImages({ spec: { containers: [{ image: "nginx" }, { image: "" }, { image: "redis" }] } })).toEqual(["nginx", "redis"]);
    expect(podTemplateImages({})).toEqual([]);
  });

  it("workloadLabelSelector builds a label query from matchLabels", () => {
    expect(workloadLabelSelector({ spec: { selector: { matchLabels: { app: "web", tier: "fe" } } } })).toBe("app=web,tier=fe");
    expect(workloadLabelSelector({})).toBe("");
  });

  it("isApplyConflictError detects 409 ApiError and conflict messages", () => {
    expect(isApplyConflictError(new ApiError(409, "boom"), "")).toBe(true);
    expect(isApplyConflictError(new ApiError(500, "boom"), "")).toBe(false);
    expect(isApplyConflictError(new Error("boom"), "apply conflict detected")).toBe(true);
    expect(isApplyConflictError(new Error("boom"), "all good")).toBe(false);
  });
});
