import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import type { Cluster } from "../../lib/api";
import { cn } from "../../lib/utils";

type BreadcrumbsProps = {
  clusters: Cluster[];
};

const routeLabels: Record<string, string> = {
  settings: "Settings",
  projects: "Projects",
  new: "Create",
  edit: "Edit",
  install: "Install",
  upgrade: "Upgrade",
  topology: "Topology",
  extensions: "Plugins",
  clusters: "Clusters",
  resources: "API Resources",
  metrics: "Metrics",
  events: "Events",
  nodes: "Nodes",
  namespaces: "Namespaces",
  pods: "Pods",
  logs: "Logs",
  exec: "Exec",
  attach: "Attach",
  "port-forward": "Port Forward",
  endpointslices: "EndpointSlices",
  verticalpodautoscalers: "VPAs",
  jobsets: "JobSets",
  deployments: "Deployments",
  replicasets: "ReplicaSets",
  daemonsets: "DaemonSets",
  statefulsets: "StatefulSets",
  jobs: "Jobs",
  cronjobs: "CronJobs",
  services: "Services",
  endpoints: "Endpoints",
  ingresses: "Ingresses",
  ingressclasses: "IngressClasses",
  persistentvolumes: "PersistentVolumes",
  persistentvolumeclaims: "PVCs",
  storageclasses: "StorageClasses",
  configmaps: "ConfigMaps",
  secrets: "Secrets",
  networkpolicies: "Network Policies",
  horizontalpodautoscalers: "HPAs",
  serviceaccounts: "ServiceAccounts",
  roles: "Roles",
  rolebindings: "RoleBindings",
  clusterroles: "ClusterRoles",
  clusterrolebindings: "ClusterRoleBindings",
  resourcequotas: "ResourceQuotas",
  limitranges: "LimitRanges",
  leases: "Leases",
  gateways: "Gateways",
  gatewayclasses: "GatewayClasses",
  httproutes: "HTTPRoutes",
  grpcroutes: "GRPCRoutes",
  referencegrants: "ReferenceGrants",
  backendtlspolicies: "BackendTLSPolicies",
  xbackendtrafficpolicies: "XBackendTrafficPolicies",
  priorityclasses: "PriorityClasses",
  runtimeclasses: "RuntimeClasses",
  mutatingwebhookconfigurations: "Mutating Webhooks",
  validatingwebhookconfigurations: "Validating Webhooks",
  crds: "CRDs",
  poddisruptionbudgets: "PDB"
};

export function Breadcrumbs({ clusters }: BreadcrumbsProps) {
  const location = useLocation();
  const crumbs = buildBreadcrumbs(location.pathname, clusters);

  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Breadcrumb">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <div key={`${crumb.href}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
            {isLast || !crumb.navigable ? (
              <span className={cn("truncate", isLast ? "font-medium text-foreground" : "text-muted-foreground")}>{crumb.label}</span>
            ) : (
              <Link className={cn("truncate text-muted-foreground transition-colors hover:text-foreground")} to={crumb.href}>
                {crumb.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function buildBreadcrumbs(pathname: string, clusters: Cluster[]) {
  const segments = pathname.split("/").filter(Boolean);
  const clusterMap = new Map(clusters.map((cluster) => [cluster.id, cluster.name]));
  const crumbs: { label: string; href: string; navigable: boolean }[] = [{ label: "Dashboard", href: "/", navigable: true }];

  if (segments.length === 0) {
    crumbs.push({ label: "Clusters", href: "/", navigable: true });
    return crumbs;
  }

  let href = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    href += `/${segment}`;
    if (segment === "clusters") continue;

    // The cluster id and known page routes are real routes; raw data segments
    // (namespace, resource name in deep pod paths) are not — render them as
    // plain text so clicking them doesn't fall through to the catch-all redirect.
    const isCluster = segments[index - 1] === "clusters";
    let label: string;
    let navigable: boolean;
    if (isCluster) {
      label = clusterMap.get(segment) ?? decodeURIComponent(segment);
      navigable = true;
    } else {
      const known = routeLabels[segment];
      label = known ?? decodeURIComponent(segment);
      navigable = known !== undefined && segment !== "extensions";
    }
    crumbs.push({ label, href, navigable });
  }

  return crumbs;
}
