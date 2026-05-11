import { Box, ExternalLink, Layers, Server, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Cluster, Dashboard } from "../../lib/api";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";

type ClusterCardProps = {
  cluster: Cluster;
  busy?: boolean;
  onRemove?: (cluster: Cluster) => void;
};

export function ClusterCard({ cluster, busy, onRemove }: ClusterCardProps) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);

  useEffect(() => {
    if (clusterStatus(cluster) === "unreachable") {
      setDashboard(null);
      return;
    }

    let cancelled = false;
    api
      .dashboard(cluster.id)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch(() => {
        if (!cancelled) setDashboard(null);
      });

    return () => {
      cancelled = true;
    };
  }, [cluster]);

  return (
    <article
      className={cn(
        "group rounded-lg border border-border bg-card p-4 transition-all",
        "hover:border-border/80 hover:bg-card/80 hover:shadow-lg hover:shadow-black/5"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link to={`/clusters/${cluster.id}`} className="flex min-w-0 items-center gap-2 font-medium text-foreground hover:text-foreground/90">
            <span className="truncate">{cluster.name}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{cluster.context}</p>
        </div>
        <StatusBadge status={clusterStatus(cluster)} label={clusterStatusLabel(cluster)} size="sm" />
      </div>

      <div className="mt-3 rounded-md border border-border/70 bg-background/45 px-3 py-2">
        <p className="truncate font-mono text-xs text-muted-foreground">{cluster.server}</p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <ClusterStat icon={<Server className="h-3.5 w-3.5" />} label="Nodes" value={dashboard?.nodeCount ?? "-"} />
        <ClusterStat icon={<Box className="h-3.5 w-3.5" />} label="Pods" value={dashboard?.podCount ?? "-"} />
        <ClusterStat icon={<Layers className="h-3.5 w-3.5" />} label="Namespaces" value={dashboard?.namespaceCount ?? "-"} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <Badge tone={cluster.source === "managed" ? "default" : "muted"}>{cluster.source === "managed" ? "app-managed" : "managed externally"}</Badge>
        {cluster.source === "managed" ? (
          <Button variant="ghost" size="sm" onClick={() => onRemove?.(cluster)} disabled={busy} aria-label={`Remove ${cluster.name}`}>
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        ) : null}
      </div>

      {cluster.error ? <p className="mt-3 truncate text-xs text-destructive">{cluster.error}</p> : null}
    </article>
  );
}

function ClusterStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/45 p-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function clusterStatus(cluster: Cluster) {
  return cluster.status ?? (cluster.reachable ? "reachable" : "unreachable");
}

function clusterStatusLabel(cluster: Cluster) {
  const status = clusterStatus(cluster);
  if (status === "reachable") return cluster.version || "Reachable";
  if (status === "degraded") return cluster.version ? `${cluster.version} degraded` : "Degraded";
  return "Unreachable";
}
