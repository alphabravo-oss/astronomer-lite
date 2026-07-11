import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Moon, Search, Server, Sun } from "lucide-react";
import type { Cluster, SearchHit } from "../lib/api";
import { api } from "../lib/api";
import { resourceConfigs } from "../lib/resources";
import { useTheme } from "../lib/theme";
import { navPlugins } from "../plugins/registry";
import { StatusBadge } from "./ui/status-badge";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusters: Cluster[];
};

// ⌘K palette — fuzzy nav over the plugin registry the sidebar uses, cluster
// jump, a theme command, and (prefix the query with "/") live resource search
// against the active cluster. Mounted once at the shell.
export function CommandPalette({ open, onOpenChange, clusters }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { clusterId } = useParams();
  const { theme, toggleTheme } = useTheme();
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchPending, setSearchPending] = useState(false);

  const searchMode = search.startsWith("/");
  const resourceQuery = searchMode ? search.slice(1).trim() : "";
  const pages = useMemo(() => (clusterId ? navPlugins() : []), [clusterId]);

  // Live resource search when the query is prefixed with "/". Debounced; the
  // backend already fuzzy-matches, so cmdk filtering is turned off in this mode.
  useEffect(() => {
    if (!open || !searchMode || !clusterId || resourceQuery.length < 2) {
      setHits([]);
      setSearchPending(false);
      return;
    }
    let cancelled = false;
    setSearchPending(true);
    const handle = window.setTimeout(() => {
      api
        .search(clusterId, resourceQuery)
        .then((results) => {
          if (!cancelled) setHits(results);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearchPending(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, searchMode, clusterId, resourceQuery]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  function go(path: string) {
    onOpenChange(false);
    setSearch("");
    navigate(path);
  }

  function openHit(hit: SearchHit) {
    if (!clusterId) return;
    const route = resourceConfigs.find((res) => res.resource === hit.resource && res.version === hit.apiVersion.split("/").pop());
    go(route ? `/clusters/${clusterId}/${route.route}` : `/clusters/${clusterId}/resources?q=${encodeURIComponent(hit.resource)}`);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={!searchMode}>
      <CommandInput value={search} onValueChange={setSearch} placeholder="Search pages and clusters, or / to search resources..." />
      <CommandList>
        <CommandEmpty>{searchMode && searchPending ? "Searching…" : "No results found."}</CommandEmpty>

        {searchMode ? (
          clusterId ? (
            <CommandGroup heading="Resources">
              {hits.slice(0, 50).map((hit, index) => (
                <CommandItem
                  key={`${hit.kind}:${hit.namespace ?? ""}:${hit.name}:${index}`}
                  value={`${hit.name} ${hit.kind} ${hit.namespace ?? ""}`}
                  onSelect={() => openHit(hit)}
                >
                  <Search className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground/70">
                    {hit.kind}
                    {hit.namespace ? ` · ${hit.namespace}` : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null
        ) : (
          <>
            {pages.length > 0 ? (
              <CommandGroup heading="Pages">
                {pages.map((page) => {
                  const Icon = page.icon;
                  return (
                    <CommandItem
                      key={page.id}
                      value={`${page.label} ${page.group}`}
                      onSelect={() => go(`/clusters/${clusterId}${page.route ? `/${page.route}` : ""}`)}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{page.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground/70">{page.group}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}

            {clusters.length > 0 ? (
              <CommandGroup heading="Clusters">
                {clusters.map((cluster) => {
                  const status = cluster.status ?? (cluster.reachable ? "reachable" : "unreachable");
                  return (
                    <CommandItem
                      key={cluster.id}
                      value={`${cluster.name} ${cluster.context ?? ""} ${cluster.server ?? ""}`}
                      onSelect={() => go(`/clusters/${cluster.id}`)}
                    >
                      <Server className="h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{cluster.name}</p>
                        <p className="truncate text-xs text-muted-foreground/70">{cluster.context || cluster.server}</p>
                      </div>
                      <StatusBadge status={status} size="sm" pulse={false} className="shrink-0" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}

            <CommandGroup heading="Commands">
              <CommandItem
                value="toggle theme dark light appearance"
                onSelect={() => {
                  toggleTheme();
                  onOpenChange(false);
                }}
              >
                {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">Toggle theme</span>
                <span className="shrink-0 text-xs text-muted-foreground/70">{theme === "dark" ? "Light" : "Dark"}</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
