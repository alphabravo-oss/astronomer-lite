import { Check, ChevronDown, Copy, ExternalLink, Menu, Moon, Plug, RefreshCcw, Search, Server, Square, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Cluster, Namespace, PortForward } from "../../lib/api";
import { api } from "../../lib/api";
import { clusterStatus } from "../../lib/cluster";
import { useTheme } from "../../lib/theme";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { StatusBadge } from "../ui/status-badge";
import { ClusterChip } from "../clusters/cluster-chip";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Breadcrumbs } from "./breadcrumbs";

type TopbarProps = {
  clusters: Cluster[];
  onRefresh: () => void;
  selectedNamespaces: string[];
  onSelectedNamespacesChange: (namespaces: string[]) => void;
  onOpenMobileNav: () => void;
  onOpenCommandPalette: () => void;
};

export function Topbar({ clusters, onRefresh, selectedNamespaces, onSelectedNamespacesChange, onOpenMobileNav, onOpenCommandPalette }: TopbarProps) {
  const { clusterId } = useParams();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [namespaceError, setNamespaceError] = useState("");
  const [portForwards, setPortForwards] = useState<PortForward[]>([]);
  const [portForwardError, setPortForwardError] = useState("");
  const [copiedPortForwardId, setCopiedPortForwardId] = useState("");
  const [clusterQuery, setClusterQuery] = useState("");
  const availableNamespaceNames = useMemo(() => namespaces.map((namespace) => namespace.name), [namespaces]);
  const activeCluster = useMemo(() => clusters.find((cluster) => cluster.id === clusterId) ?? null, [clusterId, clusters]);
  const filteredClusters = useMemo(() => {
    const query = clusterQuery.trim().toLowerCase();
    if (!query) return clusters;
    return clusters.filter((cluster) =>
      [cluster.name, cluster.context, cluster.server, clusterStatus(cluster)]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [clusterQuery, clusters]);

  const loadPortForwards = useCallback(async () => {
    if (!clusterId) return;
    try {
      const rows = await api.portForwards(clusterId);
      setPortForwards((prev) => (samePortForwards(prev, rows) ? prev : rows));
      setPortForwardError("");
    } catch (err) {
      setPortForwardError(err instanceof Error ? err.message : "Failed to load port-forwards");
    }
  }, [clusterId]);

  useEffect(() => {
    setNamespaces([]);
    setNamespaceError("");
    if (!clusterId) {
      return;
    }
    let cancelled = false;
    api
      .namespaces(clusterId)
      .then((data) => {
        if (!cancelled) {
          setNamespaces(data);
          setNamespaceError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setNamespaceError(err instanceof Error ? err.message : "Failed to load namespaces");
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId]);

  useEffect(() => {
    if (!availableNamespaceNames.length || selectedNamespaces.length === 0) return;
    const available = new Set(availableNamespaceNames);
    const next = selectedNamespaces.filter((namespace) => available.has(namespace));
    if (next.length !== selectedNamespaces.length) onSelectedNamespacesChange(next);
  }, [availableNamespaceNames, onSelectedNamespacesChange, selectedNamespaces]);

  useEffect(() => {
    setPortForwards([]);
    setPortForwardError("");
    if (!clusterId) return;
    void loadPortForwards();
    const timer = window.setInterval(() => void loadPortForwards(), 5_000);
    return () => window.clearInterval(timer);
  }, [clusterId, loadPortForwards]);

  function toggleNamespace(namespace: string) {
    if (selectedNamespaces.includes(namespace)) {
      onSelectedNamespacesChange(selectedNamespaces.filter((item) => item !== namespace));
    } else {
      onSelectedNamespacesChange([...selectedNamespaces, namespace].sort());
    }
  }

  async function stopPortForward(sessionId: string) {
    if (!clusterId) return;
    try {
      await api.stopPortForward(clusterId, sessionId);
      setPortForwards((current) => current.filter((session) => session.id !== sessionId));
      setPortForwardError("");
    } catch (err) {
      setPortForwardError(err instanceof Error ? err.message : "Failed to stop port-forward");
    }
  }

  async function copyPortForwardUrl(session: PortForward) {
    try {
      await navigator.clipboard.writeText(session.url);
      setCopiedPortForwardId(session.id);
      window.setTimeout(() => setCopiedPortForwardId((current) => (current === session.id ? "" : current)), 1_500);
      setPortForwardError("");
    } catch (err) {
      setPortForwardError(err instanceof Error ? err.message : "Failed to copy URL");
    }
  }

  function selectCluster(nextClusterId: string) {
    setClusterQuery("");
    navigate(nextClusterId ? `/clusters/${nextClusterId}` : "/");
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-lg md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onOpenMobileNav} className="lg:hidden" aria-label="Open navigation">
          <Menu className="h-4 w-4" />
        </Button>
        <Breadcrumbs clusters={clusters} />
      </div>
      <div className="hidden flex-1 justify-center px-6 md:flex">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open command palette"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">Search pages, clusters, actions...</span>
          <kbd className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {clusterId ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title={namespaceError || "Namespace filter"}
              >
                <span>{selectedNamespaces.length === 0 ? "All namespaces" : `${selectedNamespaces.length} namespaces`}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <div className="flex items-center justify-between border-b border-border p-2">
                <span className="text-xs font-medium uppercase text-muted-foreground">Namespaces</span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onSelectedNamespacesChange([])}
                >
                  Clear
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto p-2">
                {namespaces.map((namespace) => (
                  <label
                    key={namespace.name}
                    className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="namespace-filter"
                        className="rounded border-border bg-background text-primary focus:ring-ring"
                        checked={selectedNamespaces.includes(namespace.name)}
                        onChange={() => toggleNamespace(namespace.name)}
                      />
                      <span>{namespace.name}</span>
                    </span>
                    <Badge tone={namespace.status === "Active" ? "success" : "warning"}>{namespace.status}</Badge>
                  </label>
                ))}
                {namespaces.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    {namespaceError || "No namespaces loaded."}
                  </div>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
        {clusterId ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="relative inline-flex h-9 w-9 items-center justify-center gap-2 rounded-md border border-transparent bg-transparent text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Active port-forwards"
                title={portForwardError || "Active port-forwards"}
              >
                <Plug className="h-4 w-4" />
                {portForwards.length > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
                    {portForwards.length}
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(24rem,calc(100vw-2rem))]">
                <div className="flex items-center justify-between border-b border-border p-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Port-forwards</h2>
                    <p className="text-xs text-muted-foreground">{portForwards.length} active sessions</p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => void loadPortForwards()}
                  >
                    Refresh
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto p-2">
                  {portForwardError ? (
                    <div className="mb-2 rounded-md border border-destructive/35 bg-destructive/10 p-2 text-xs text-destructive">
                      {portForwardError}
                    </div>
                  ) : null}
                  {portForwards.map((session) => {
                    const resourceKind = session.resourceKind || "pod";
                    const resourceName = session.resourceName || session.pod;
                    const sessionRoute =
                      resourceKind === "service"
                        ? `/clusters/${clusterId}/services/${encodeURIComponent(session.namespace)}/${encodeURIComponent(resourceName)}/port-forward`
                        : `/clusters/${clusterId}/pods/${encodeURIComponent(session.namespace)}/${encodeURIComponent(session.pod)}/port-forward`;
                    return (
                    <div key={session.id} className="rounded-md border border-border bg-background p-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            to={sessionRoute}
                            className="block truncate text-sm font-medium text-foreground hover:underline"
                          >
                            {resourceName}
                          </Link>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {session.namespace} / {resourceKind === "service" ? `service via ${session.pod}` : "pod"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void copyPortForwardUrl(session)}
                            aria-label={`Copy ${resourceName} port-forward URL`}
                          >
                            {copiedPortForwardId === session.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => void stopPortForward(session.id)} aria-label={`Stop ${resourceName} port-forward`}>
                            <Square className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                        <a
                          href={session.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-w-0 items-center gap-1.5 font-mono text-foreground hover:underline"
                        >
                          <span className="truncate">{session.url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        <span className="shrink-0 text-muted-foreground">{session.remotePort}/TCP</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{formatPortForwardExpiry(session.expiresAt)}</p>
                    </div>
                    );
                  })}
                  {portForwards.length === 0 ? (
                    <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                      No active port-forwards for this cluster.
                    </div>
                  ) : null}
                </div>
            </PopoverContent>
          </Popover>
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 max-w-[13rem] items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Select cluster"
            >
              {activeCluster ? <ClusterChip cluster={activeCluster} size="sm" /> : <Server className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{activeCluster?.name ?? "All Clusters"}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(20rem,calc(100vw-2rem))]">
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="topbar-cluster-search"
                    name="cluster-search"
                    type="text"
                    value={clusterQuery}
                    onChange={(event) => setClusterQuery(event.target.value)}
                    placeholder="Search clusters..."
                    className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label="Clusters">
                <PopoverClose asChild>
                  <button
                    type="button"
                    onClick={() => selectCluster("")}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      !activeCluster ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                    role="option"
                    aria-selected={!activeCluster}
                  >
                    <Server className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">All Clusters</p>
                      <p className="truncate text-2xs text-muted-foreground">Cluster inventory</p>
                    </div>
                    {!activeCluster ? <Check className="h-4 w-4" /> : null}
                  </button>
                </PopoverClose>
                {filteredClusters.map((cluster) => (
                  <PopoverClose asChild key={cluster.id}>
                    <button
                      type="button"
                      onClick={() => selectCluster(cluster.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        activeCluster?.id === cluster.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                      role="option"
                      aria-selected={activeCluster?.id === cluster.id}
                    >
                      <Server className="h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{cluster.name}</p>
                        <p className="truncate text-2xs text-muted-foreground">{cluster.context || cluster.server}</p>
                      </div>
                      <StatusBadge status={cluster.status ?? (cluster.reachable ? "reachable" : "unreachable")} size="sm" label={cluster.status ?? (cluster.reachable ? "Reachable" : "Unreachable")} pulse={false} />
                    </button>
                  </PopoverClose>
                ))}
                {filteredClusters.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">No clusters match.</div>
                ) : null}
              </div>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh clusters">
          <RefreshCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-pressed={theme === "dark"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}

function samePortForwards(a: PortForward[], b: PortForward[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.expiresAt !== y.expiresAt || x.error !== y.error || x.url !== y.url || x.localPort !== y.localPort) {
      return false;
    }
  }
  return true;
}

function formatPortForwardExpiry(value?: string) {
  if (!value) return "No expiration reported";
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return "Expiration unavailable";
  const minutes = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 60_000));
  if (minutes === 0) return "Expires in less than a minute";
  if (minutes === 1) return "Expires in 1 minute";
  return `Expires in ${minutes} minutes`;
}
