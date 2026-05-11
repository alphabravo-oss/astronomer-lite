import type { ReactNode } from "react";
import { Activity, BarChart3, Container, Gauge, Puzzle, Wrench, type LucideIcon } from "lucide-react";
import { ClusterDashboard } from "../pages/cluster-dashboard";
import { PodsPage } from "../pages/pods";
import type { Cluster } from "../lib/api";
import { resourceConfigs } from "../lib/resources";
import { EventsPage } from "../pages/events";
import { GenericResourceBrowser } from "../pages/generic-resource-browser";
import { MetricsPage } from "../pages/metrics";
import { ResourceListPage } from "../pages/resource-list";

export type NavItemPlugin = {
  id: string;
  label: string;
  route: string;
  group: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export type ResourcePagePlugin = NavItemPlugin & {
  element: ReactNode;
};

export type ResourceActionPlugin<TResource = unknown> = {
  id: string;
  label: string;
  resource: string;
  render: (resource: TResource) => ReactNode;
  isVisible?: (resource: TResource) => boolean;
};

const internalPagePlugins = [
  {
    id: "dashboard",
    label: "Dashboard",
    route: "",
    group: "Cluster",
    icon: Gauge
  },
  {
    id: "api-resources",
    label: "API Resources",
    route: "resources",
    group: "Cluster",
    icon: Puzzle
  },
  {
    id: "metrics",
    label: "Metrics",
    route: "metrics",
    group: "Cluster",
    icon: BarChart3
  },
  {
    id: "events",
    label: "Events",
    route: "events",
    group: "Cluster",
    icon: Activity
  },
  {
    id: "pods",
    label: "Pods",
    route: "pods",
    group: "Workloads",
    icon: Container
  }
] satisfies NavItemPlugin[];

const internalToolPlugins = [
  {
    id: "tools",
    label: "Tools",
    route: "tools",
    group: "Cluster",
    icon: Wrench,
    disabled: true
  }
] satisfies NavItemPlugin[];

export function navPlugins(): NavItemPlugin[] {
  return [
    ...internalPagePlugins,
    ...internalToolPlugins,
    ...resourceConfigs
      .filter((resource) => resource.id !== "events")
      .map((resource) => ({
        id: resource.id,
        label: resource.label,
        route: resource.route,
        group: resource.group,
        icon: resource.icon
      }))
  ];
}

export function resourcePlugins(clusters: Cluster[], selectedNamespaces: string[]): ResourcePagePlugin[] {
  return [
    {
      ...internalPagePlugins[0],
      element: <ClusterDashboard clusters={clusters} />
    },
    {
      ...internalPagePlugins[1],
      element: <GenericResourceBrowser selectedNamespaces={selectedNamespaces} />
    },
    {
      ...internalPagePlugins[2],
      element: <MetricsPage />
    },
    {
      ...internalPagePlugins[3],
      element: <EventsPage selectedNamespaces={selectedNamespaces} />
    },
    {
      ...internalPagePlugins[4],
      element: <PodsPage selectedNamespaces={selectedNamespaces} />
    },
    ...resourceConfigs.filter((resource) => resource.id !== "events").map((resource) => ({
      id: resource.id,
      label: resource.label,
      route: resource.route,
      group: resource.group,
      icon: resource.icon,
      element: <ResourceListPage resourceId={resource.route} selectedNamespaces={selectedNamespaces} />
    }))
  ];
}

export function resourceActionPlugins(): ResourceActionPlugin[] {
  return [];
}
