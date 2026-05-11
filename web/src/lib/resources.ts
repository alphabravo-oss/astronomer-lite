import {
  Activity,
  Box,
  Clock,
  Database,
  FileText,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Lock,
  Network,
  Puzzle,
  Server,
  Shield,
  ShieldCheck,
  UserCircle
} from "lucide-react";

export type ResourceConfig = {
  id: string;
  label: string;
  route: string;
  group: string;
  icon: typeof Box;
  namespaced: boolean;
  apiGroup: string;
  version: string;
  resource: string;
};

export const resourceConfigs: ResourceConfig[] = [
  { id: "nodes", label: "Nodes", route: "nodes", group: "Cluster", icon: Server, namespaced: false, apiGroup: "", version: "v1", resource: "nodes" },
  { id: "namespaces", label: "Namespaces", route: "namespaces", group: "Cluster", icon: Layers, namespaced: false, apiGroup: "", version: "v1", resource: "namespaces" },
  { id: "events", label: "Events", route: "events", group: "Cluster", icon: Activity, namespaced: true, apiGroup: "events.k8s.io", version: "v1", resource: "events" },
  { id: "deployments", label: "Deployments", route: "deployments", group: "Workloads", icon: Box, namespaced: true, apiGroup: "apps", version: "v1", resource: "deployments" },
  { id: "replicasets", label: "ReplicaSets", route: "replicasets", group: "Workloads", icon: Box, namespaced: true, apiGroup: "apps", version: "v1", resource: "replicasets" },
  { id: "daemonsets", label: "DaemonSets", route: "daemonsets", group: "Workloads", icon: Server, namespaced: true, apiGroup: "apps", version: "v1", resource: "daemonsets" },
  { id: "statefulsets", label: "StatefulSets", route: "statefulsets", group: "Workloads", icon: Database, namespaced: true, apiGroup: "apps", version: "v1", resource: "statefulsets" },
  { id: "jobs", label: "Jobs", route: "jobs", group: "Workloads", icon: Clock, namespaced: true, apiGroup: "batch", version: "v1", resource: "jobs" },
  { id: "cronjobs", label: "CronJobs", route: "cronjobs", group: "Workloads", icon: Clock, namespaced: true, apiGroup: "batch", version: "v1", resource: "cronjobs" },
  { id: "services", label: "Services", route: "services", group: "Service Discovery", icon: Network, namespaced: true, apiGroup: "", version: "v1", resource: "services" },
  { id: "endpoints", label: "Endpoints", route: "endpoints", group: "Service Discovery", icon: Network, namespaced: true, apiGroup: "", version: "v1", resource: "endpoints" },
  { id: "endpointslices", label: "EndpointSlices", route: "endpointslices", group: "Service Discovery", icon: Network, namespaced: true, apiGroup: "discovery.k8s.io", version: "v1", resource: "endpointslices" },
  { id: "ingresses", label: "Ingresses", route: "ingresses", group: "Service Discovery", icon: Globe, namespaced: true, apiGroup: "networking.k8s.io", version: "v1", resource: "ingresses" },
  { id: "ingressclasses", label: "IngressClasses", route: "ingressclasses", group: "Service Discovery", icon: Globe, namespaced: false, apiGroup: "networking.k8s.io", version: "v1", resource: "ingressclasses" },
  { id: "gateways", label: "Gateways", route: "gateways", group: "Gateway API", icon: Globe, namespaced: true, apiGroup: "gateway.networking.k8s.io", version: "v1", resource: "gateways" },
  { id: "gatewayclasses", label: "GatewayClasses", route: "gatewayclasses", group: "Gateway API", icon: Network, namespaced: false, apiGroup: "gateway.networking.k8s.io", version: "v1", resource: "gatewayclasses" },
  { id: "httproutes", label: "HTTPRoutes", route: "httproutes", group: "Gateway API", icon: Globe, namespaced: true, apiGroup: "gateway.networking.k8s.io", version: "v1", resource: "httproutes" },
  { id: "grpcroutes", label: "GRPCRoutes", route: "grpcroutes", group: "Gateway API", icon: Network, namespaced: true, apiGroup: "gateway.networking.k8s.io", version: "v1", resource: "grpcroutes" },
  { id: "referencegrants", label: "ReferenceGrants", route: "referencegrants", group: "Gateway API", icon: ShieldCheck, namespaced: true, apiGroup: "gateway.networking.k8s.io", version: "v1beta1", resource: "referencegrants" },
  { id: "backendtlspolicies", label: "BackendTLSPolicies", route: "backendtlspolicies", group: "Gateway API", icon: ShieldCheck, namespaced: true, apiGroup: "gateway.networking.k8s.io", version: "v1alpha3", resource: "backendtlspolicies" },
  { id: "xbackendtrafficpolicies", label: "XBackendTrafficPolicies", route: "xbackendtrafficpolicies", group: "Gateway API", icon: Shield, namespaced: true, apiGroup: "gateway.networking.x-k8s.io", version: "v1alpha1", resource: "xbackendtrafficpolicies" },
  { id: "persistentvolumes", label: "PersistentVolumes", route: "persistentvolumes", group: "Storage", icon: HardDrive, namespaced: false, apiGroup: "", version: "v1", resource: "persistentvolumes" },
  { id: "persistentvolumeclaims", label: "PVCs", route: "persistentvolumeclaims", group: "Storage", icon: Database, namespaced: true, apiGroup: "", version: "v1", resource: "persistentvolumeclaims" },
  { id: "storageclasses", label: "StorageClasses", route: "storageclasses", group: "Storage", icon: Database, namespaced: false, apiGroup: "storage.k8s.io", version: "v1", resource: "storageclasses" },
  { id: "configmaps", label: "ConfigMaps", route: "configmaps", group: "Storage", icon: FileText, namespaced: true, apiGroup: "", version: "v1", resource: "configmaps" },
  { id: "secrets", label: "Secrets", route: "secrets", group: "Storage", icon: Lock, namespaced: true, apiGroup: "", version: "v1", resource: "secrets" },
  { id: "networkpolicies", label: "Network Policies", route: "networkpolicies", group: "Policy", icon: Shield, namespaced: true, apiGroup: "networking.k8s.io", version: "v1", resource: "networkpolicies" },
  { id: "horizontalpodautoscalers", label: "HPAs", route: "horizontalpodautoscalers", group: "Policy", icon: Activity, namespaced: true, apiGroup: "autoscaling", version: "v2", resource: "horizontalpodautoscalers" },
  { id: "poddisruptionbudgets", label: "PDB", route: "poddisruptionbudgets", group: "Policy", icon: ShieldCheck, namespaced: true, apiGroup: "policy", version: "v1", resource: "poddisruptionbudgets" },
  { id: "serviceaccounts", label: "ServiceAccounts", route: "serviceaccounts", group: "More Resources", icon: UserCircle, namespaced: true, apiGroup: "", version: "v1", resource: "serviceaccounts" },
  { id: "roles", label: "Roles", route: "roles", group: "More Resources", icon: KeyRound, namespaced: true, apiGroup: "rbac.authorization.k8s.io", version: "v1", resource: "roles" },
  { id: "rolebindings", label: "RoleBindings", route: "rolebindings", group: "More Resources", icon: KeyRound, namespaced: true, apiGroup: "rbac.authorization.k8s.io", version: "v1", resource: "rolebindings" },
  { id: "clusterroles", label: "ClusterRoles", route: "clusterroles", group: "More Resources", icon: KeyRound, namespaced: false, apiGroup: "rbac.authorization.k8s.io", version: "v1", resource: "clusterroles" },
  { id: "clusterrolebindings", label: "ClusterRoleBindings", route: "clusterrolebindings", group: "More Resources", icon: KeyRound, namespaced: false, apiGroup: "rbac.authorization.k8s.io", version: "v1", resource: "clusterrolebindings" },
  { id: "resourcequotas", label: "ResourceQuotas", route: "resourcequotas", group: "More Resources", icon: ShieldCheck, namespaced: true, apiGroup: "", version: "v1", resource: "resourcequotas" },
  { id: "limitranges", label: "LimitRanges", route: "limitranges", group: "More Resources", icon: ShieldCheck, namespaced: true, apiGroup: "", version: "v1", resource: "limitranges" },
  { id: "leases", label: "Leases", route: "leases", group: "More Resources", icon: Clock, namespaced: true, apiGroup: "coordination.k8s.io", version: "v1", resource: "leases" },
  { id: "priorityclasses", label: "PriorityClasses", route: "priorityclasses", group: "More Resources", icon: ShieldCheck, namespaced: false, apiGroup: "scheduling.k8s.io", version: "v1", resource: "priorityclasses" },
  { id: "runtimeclasses", label: "RuntimeClasses", route: "runtimeclasses", group: "More Resources", icon: Server, namespaced: false, apiGroup: "node.k8s.io", version: "v1", resource: "runtimeclasses" },
  { id: "mutatingwebhookconfigurations", label: "Mutating Webhooks", route: "mutatingwebhookconfigurations", group: "More Resources", icon: Shield, namespaced: false, apiGroup: "admissionregistration.k8s.io", version: "v1", resource: "mutatingwebhookconfigurations" },
  { id: "validatingwebhookconfigurations", label: "Validating Webhooks", route: "validatingwebhookconfigurations", group: "More Resources", icon: Shield, namespaced: false, apiGroup: "admissionregistration.k8s.io", version: "v1", resource: "validatingwebhookconfigurations" },
  { id: "crds", label: "CRDs", route: "crds", group: "More Resources", icon: Puzzle, namespaced: false, apiGroup: "apiextensions.k8s.io", version: "v1", resource: "customresourcedefinitions" }
];

export function resourceByRoute(route: string) {
  return resourceConfigs.find((resource) => resource.route === route);
}
