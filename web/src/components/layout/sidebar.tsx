import { ArrowLeft, BookOpen, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Orbit, Server, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import type { Cluster } from "../../lib/api";
import { clusterStatus } from "../../lib/cluster";
import { useFavorites } from "../../lib/favorites";
import { resourceConfigs } from "../../lib/resources";
import { cn } from "../../lib/utils";
import { navPlugins, type NavItemPlugin } from "../../plugins/registry";
import { ClusterChip } from "../clusters/cluster-chip";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

type SidebarGroup = {
  label: string;
  items: NavItemPlugin[];
};

const groupOrder = ["Cluster", "Workloads", "Service Discovery", "Storage", "Policy", "Helm", "More Resources"];

function sidebarGroups(clusterId?: string, availableResourceIds?: Set<string>): SidebarGroup[] {
  if (!clusterId) {
    return [
      {
        label: "Platform",
        items: [
          {
            id: "clusters",
            label: "Clusters",
            route: "",
            group: "Platform",
            icon: Server
          }
        ]
      }
    ];
  }

  const resourceIds = new Set(resourceConfigs.map((resource) => resource.id));
  const items = navPlugins().filter((item) => !resourceIds.has(item.id) || !availableResourceIds || availableResourceIds.has(item.id));
  const groups = Array.from(new Set([...groupOrder, ...items.map((item) => item.group)]));
  return groups
    .map((label) => ({
      label,
      items: items.filter((item) => item.group === label)
    }))
    .filter((group) => group.items.length > 0);
}

export function Sidebar({ clusters }: { clusters: Cluster[] }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={cn("hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 ease-in-out lg:flex", collapsed ? "w-16" : "w-60")}>
      <SidebarContent clusters={clusters} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} />
    </aside>
  );
}

export function MobileSidebarDrawer({ clusters, open, onClose }: { clusters: Cluster[]; open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="left-0 top-0 flex h-full w-[min(18rem,calc(100vw-3rem))] max-w-xs translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-l-0 border-r border-sidebar-border bg-sidebar p-0 shadow-2xl data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left lg:hidden"
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <SidebarContent clusters={clusters} collapsed={false} onNavigate={onClose} mobile />
      </DialogContent>
    </Dialog>
  );
}

function SidebarContent({
  clusters,
  collapsed,
  mobile = false,
  onNavigate,
  onToggleCollapsed
}: {
  clusters: Cluster[];
  collapsed: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
  onToggleCollapsed?: () => void;
}) {
  const { clusterId } = useParams();
  const { pathname } = useLocation();
  const [availableResourceIds, setAvailableResourceIds] = useState<Set<string> | undefined>();
  const groups = useMemo(() => sidebarGroups(clusterId, availableResourceIds), [availableResourceIds, clusterId]);
  const activeCluster = clusters.find((cluster) => cluster.id === clusterId);
  const [openGroup, setOpenGroup] = useState(clusterId ? "Cluster" : "Platform");
  const { favorites } = useFavorites(clusterId);

  useEffect(() => {
    if (!clusterId) {
      setAvailableResourceIds(undefined);
      return;
    }
    let cancelled = false;
    api
      .discovery(clusterId)
      .then((resources) => {
        if (cancelled) return;
        const served = new Set(resources.map((resource) => `${resource.group}/${resource.version}/${resource.resource}`));
        const available = new Set(
          resourceConfigs
            .filter((resource) => served.has(`${resource.apiGroup}/${resource.version}/${resource.resource}`))
            .map((resource) => resource.id)
        );
        setAvailableResourceIds(available);
      })
      .catch(() => {
        if (!cancelled) setAvailableResourceIds(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId]);

  useEffect(() => {
    const activeGroup = groups.find((group) =>
      group.items.some((item) => {
        if (!clusterId) return item.route === "";
        const to = `/clusters/${clusterId}${item.route ? `/${item.route}` : ""}`;
        return item.route === "" ? pathname === to : pathname.startsWith(to);
      })
    );
    if (activeGroup) setOpenGroup(activeGroup.label);
  }, [clusterId, groups, pathname]);

  return (
    <>
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <Link to="/" className="flex min-w-0 items-center gap-2.5" onClick={onNavigate}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600">
            <Orbit className="h-4 w-4 text-white" />
          </div>
          {!collapsed ? (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold leading-tight tracking-tight text-sidebar-accent-foreground">Astronomer-Lite</span>
              <span className="truncate text-[10px] leading-tight text-sidebar-foreground">by AlphaBravo</span>
            </div>
          ) : null}
        </Link>
      </div>

      {clusterId ? (
        <div className="border-b border-sidebar-border px-2 py-2">
          <Link
            to="/"
            className={cn(
              "flex items-center rounded-md text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed ? "h-9 justify-center" : "gap-2 px-2 py-1.5"
            )}
            title="All clusters"
            onClick={onNavigate}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {!collapsed ? <span>All Clusters</span> : null}
          </Link>
          {!collapsed ? (
            <div className="mt-1 flex items-center gap-2 px-2">
              {activeCluster ? <ClusterChip cluster={activeCluster} size="md" /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sidebar-accent-foreground">{activeCluster?.name ?? "Cluster"}</p>
                <p className="truncate text-2xs text-sidebar-foreground">{clusterStatusText(activeCluster)}</p>
              </div>
            </div>
          ) : null}
          {!collapsed && activeCluster && activeCluster.links && activeCluster.links.length > 0 ? (
            <div className="mt-2 space-y-0.5 px-2">
              {activeCluster.links.map((link) => (
                <a
                  key={`${link.label}/${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  title={link.url}
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{link.label}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <nav className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {groups.map((group) => (
          <SidebarGroup
            key={group.label}
            group={group}
            clusterId={clusterId}
            collapsed={collapsed}
            isOpen={openGroup === group.label}
            onToggle={() => setOpenGroup((current) => (current === group.label ? "" : group.label))}
            onNavigate={onNavigate}
          />
        ))}
        {clusterId && favorites.length > 0 && !collapsed ? (
          <div className="mb-1 mt-2">
            <div className="flex h-8 w-full items-center px-3 text-xs font-semibold text-sidebar-foreground/75">
              <span className="inline-flex items-center gap-1.5"><Star className="h-3 w-3" /> Pinned</span>
            </div>
            <div className="mt-1 space-y-1">
              {favorites.map((fav) => {
                const route = fav.route ?? "resources";
                const target = fav.namespace
                  ? `/clusters/${clusterId}/${route}?q=${encodeURIComponent(fav.name)}`
                  : `/clusters/${clusterId}/${route}`;
                return (
                  <NavLink
                    key={`${fav.kind}/${fav.namespace ?? ""}/${fav.name}`}
                    to={target}
                    title={`${fav.kind} · ${fav.namespace ?? ""}/${fav.name}`}
                    onClick={onNavigate}
                    className={({ isActive }) => cn("nav-item h-9", isActive ? "active" : "text-sidebar-foreground")}
                  >
                    <Star className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
                    <span className="truncate">{fav.name}</span>
                    <span className="ml-auto truncate text-[10px] text-sidebar-foreground/60">{fav.kind}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ) : null}
        {!clusterId ? <ClusterListGroup clusters={clusters} collapsed={collapsed} onNavigate={onNavigate} /> : null}
      </nav>

      {!mobile && onToggleCollapsed ? (
        <div className="border-t border-sidebar-border px-2 py-2">
          {!collapsed ? (
            <>
              <a
                href="https://github.com/alphabravo/astronomer-lite"
                target="_blank"
                rel="noreferrer"
                className="nav-item mb-2 w-full"
              >
                <BookOpen className="h-4 w-4" />
                <span className="text-sm">Documentation</span>
              </a>
              <p className="px-3 pb-2 text-xs text-sidebar-foreground/60">Astronomer-Lite v0.0.0</p>
            </>
          ) : null}
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="nav-item w-full justify-center"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </button>
        </div>
      ) : null}
    </>
  );
}

function clusterStatusText(cluster?: Cluster) {
  if (!cluster) return "unreachable";
  if (cluster.version && cluster.status !== "degraded") return cluster.version;
  return clusterStatus(cluster);
}

function SidebarGroup({
  group,
  clusterId,
  collapsed,
  isOpen,
  onToggle,
  onNavigate
}: {
  group: SidebarGroup;
  clusterId?: string;
  collapsed: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  if (collapsed) {
    return (
      <div className="mb-1 space-y-1">
        {group.items.map((item) => (
          <SidebarItem key={item.id} item={item} clusterId={clusterId} collapsed onNavigate={onNavigate} />
        ))}
      </div>
    );
  }

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-7 w-full items-center justify-between rounded-md px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        <span>{group.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen ? (
        <div className="mt-1 space-y-1">
          {group.items.map((item) => (
            <SidebarItem key={item.id} item={item} clusterId={clusterId} collapsed={false} onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function clusterDotClass(cluster: Cluster) {
  const status = clusterStatus(cluster);
  if (status === "reachable") return "bg-status-success";
  if (status === "degraded") return "bg-status-warning";
  return "bg-status-error";
}

function ClusterListGroup({ clusters, collapsed, onNavigate }: { clusters: Cluster[]; collapsed: boolean; onNavigate?: () => void }) {
  if (clusters.length === 0) return null;
  if (collapsed) {
    return (
      <div className="mt-1 space-y-1">
        {clusters.map((cluster) => (
          <NavLink
            key={cluster.id}
            to={`/clusters/${cluster.id}`}
            title={`${cluster.name} (${clusterStatus(cluster)})`}
            onClick={onNavigate}
            className={({ isActive }) => cn("nav-item relative h-9 justify-center px-0", isActive ? "active" : "text-sidebar-foreground")}
          >
            <ClusterChip cluster={cluster} size="md" />
            <span className={cn("absolute bottom-1 right-1 h-2 w-2 rounded-full ring-2 ring-sidebar", clusterDotClass(cluster))} aria-hidden />
          </NavLink>
        ))}
      </div>
    );
  }
  return (
    <div className="mb-1 mt-1">
      <div className="flex h-7 w-full items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
        <span>Your Clusters</span>
      </div>
      <div className="mt-1 space-y-1">
        {clusters.map((cluster) => (
          <NavLink
            key={cluster.id}
            to={`/clusters/${cluster.id}`}
            title={cluster.context ?? cluster.name}
            onClick={onNavigate}
            className={({ isActive }) => cn("nav-item h-9", isActive ? "active" : "text-sidebar-foreground")}
          >
            <ClusterChip cluster={cluster} size="md" />
            <span className="truncate">{cluster.name}</span>
            <span className={cn("ml-auto h-2 w-2 shrink-0 rounded-full", clusterDotClass(cluster))} aria-hidden />
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function SidebarItem({ item, clusterId, collapsed, onNavigate }: { item: NavItemPlugin; clusterId?: string; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const to = clusterId ? `/clusters/${clusterId}${item.route ? `/${item.route}` : ""}` : "/";
  const classes = cn("nav-item h-9", collapsed && "justify-center px-0");

  if (item.disabled) {
    return (
      <div className={cn(classes, "text-sidebar-foreground/45")} title={item.label}>
        <Icon className="h-4 w-4" />
        {!collapsed ? <span>{item.label}</span> : null}
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      end={item.route === ""}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => cn(classes, isActive ? "active" : "text-sidebar-foreground")}
      onClick={onNavigate}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </NavLink>
  );
}
