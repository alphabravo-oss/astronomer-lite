import { lazy, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Container,
  Gauge,
  Network,
  Package,
  Puzzle,
  type LucideIcon,
} from "lucide-react";
import type { Cluster } from "../lib/api";
import { resourceConfigs } from "../lib/resources";

export type NavigationItem = {
  id: string;
  label: string;
  route: string;
  group: string;
  icon: LucideIcon;
};

export type ResourcePage = NavigationItem & {
  element: ReactNode;
};

const ClusterDashboard = lazy(() =>
  import("../pages/cluster-dashboard").then((module) => ({
    default: module.ClusterDashboard,
  })),
);
const PodsPage = lazy(() =>
  import("../pages/pods").then((module) => ({ default: module.PodsPage })),
);
const EventsPage = lazy(() =>
  import("../pages/events").then((module) => ({ default: module.EventsPage })),
);
const GenericResourceBrowser = lazy(() =>
  import("../pages/generic-resource-browser").then((module) => ({
    default: module.GenericResourceBrowser,
  })),
);
const MetricsPage = lazy(() =>
  import("../pages/metrics").then((module) => ({
    default: module.MetricsPage,
  })),
);
const ResourceListPage = lazy(() =>
  import("../pages/resource-list").then((module) => ({
    default: module.ResourceListPage,
  })),
);
const HelmReleasesPage = lazy(() =>
  import("../pages/helm-releases").then((module) => ({
    default: module.HelmReleasesPage,
  })),
);
const TopologyPage = lazy(() =>
  import("../pages/topology").then((module) => ({
    default: module.TopologyPage,
  })),
);

const builtInPages = [
  {
    id: "dashboard",
    label: "Dashboard",
    route: "",
    group: "Cluster",
    icon: Gauge,
  },
  {
    id: "api-resources",
    label: "API Resources",
    route: "resources",
    group: "Cluster",
    icon: Puzzle,
  },
  {
    id: "metrics",
    label: "Metrics",
    route: "metrics",
    group: "Cluster",
    icon: BarChart3,
  },
  {
    id: "events",
    label: "Events",
    route: "events",
    group: "Cluster",
    icon: Activity,
  },
  {
    id: "topology",
    label: "Topology",
    route: "topology",
    group: "Cluster",
    icon: Network,
  },
  {
    id: "pods",
    label: "Pods",
    route: "pods",
    group: "Workloads",
    icon: Container,
  },
  {
    id: "helm-releases",
    label: "Helm Releases",
    route: "helm/releases",
    group: "Helm",
    icon: Package,
  },
] satisfies NavigationItem[];

export function navigationItems(): NavigationItem[] {
  return [
    ...builtInPages,
    ...resourceConfigs
      .filter((resource) => resource.id !== "events")
      .map((resource) => ({
        id: resource.id,
        label: resource.label,
        route: resource.route,
        group: resource.group,
        icon: resource.icon,
      })),
  ];
}

export function resourcePages(
  clusters: Cluster[],
  selectedNamespaces: string[],
): ResourcePage[] {
  const pageElement: Record<string, ReactNode> = {
    dashboard: <ClusterDashboard clusters={clusters} />,
    "api-resources": (
      <GenericResourceBrowser selectedNamespaces={selectedNamespaces} />
    ),
    metrics: <MetricsPage />,
    events: <EventsPage selectedNamespaces={selectedNamespaces} />,
    topology: <TopologyPage />,
    pods: <PodsPage selectedNamespaces={selectedNamespaces} />,
    "helm-releases": <HelmReleasesPage />,
  };
  return [
    ...builtInPages
      .filter((page) => pageElement[page.id])
      .map((page) => ({ ...page, element: pageElement[page.id] })),
    ...resourceConfigs
      .filter((resource) => resource.id !== "events")
      .map((resource) => ({
        id: resource.id,
        label: resource.label,
        route: resource.route,
        group: resource.group,
        icon: resource.icon,
        element: (
          <ResourceListPage
            resourceId={resource.route}
            selectedNamespaces={selectedNamespaces}
          />
        ),
      })),
  ];
}
