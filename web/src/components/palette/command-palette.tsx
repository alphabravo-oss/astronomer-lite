import { Command, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Cluster, SearchHit } from "../../lib/api";
import { api } from "../../lib/api";
import { resourceConfigs } from "../../lib/resources";
import { useTheme } from "../../lib/theme";
import { cn } from "../../lib/utils";
import { navPlugins } from "../../plugins/registry";

export type PaletteCommand = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  keywords?: string;
  run: () => void;
};

type CommandPaletteProps = {
  clusters: Cluster[];
  activeClusterId?: string;
};

export function CommandPalette({ clusters, activeClusterId }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const searchMode = query.startsWith("/");
  const searchQuery = searchMode ? query.slice(1).trim() : "";

  useEffect(() => {
    if (!open || !searchMode || !activeClusterId || searchQuery.length < 2) {
      setSearchHits([]);
      setSearchPending(false);
      return;
    }
    let cancelled = false;
    setSearchPending(true);
    const handle = window.setTimeout(() => {
      api
        .search(activeClusterId, searchQuery)
        .then((hits) => {
          if (!cancelled) setSearchHits(hits);
        })
        .catch(() => {
          if (!cancelled) setSearchHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearchPending(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [activeClusterId, open, searchMode, searchQuery]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isShortcut) {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [];
    cmds.push({
      id: "go:home",
      label: "Go to All Clusters",
      group: "Navigation",
      keywords: "home clusters list",
      run: () => navigate("/")
    });
    for (const cluster of clusters) {
      cmds.push({
        id: `cluster:${cluster.id}`,
        label: `Switch to ${cluster.name}`,
        hint: cluster.context,
        group: "Clusters",
        keywords: `cluster switch ${cluster.context}`,
        run: () => navigate(`/clusters/${cluster.id}`)
      });
    }
    if (activeClusterId) {
      for (const item of navPlugins()) {
        if (item.disabled) continue;
        cmds.push({
          id: `nav:${item.id}`,
          label: `Open ${item.label}`,
          hint: item.group,
          group: "Pages",
          keywords: `${item.id} ${item.group}`,
          run: () => navigate(`/clusters/${activeClusterId}${item.route ? `/${item.route}` : ""}`)
        });
      }
    }
    cmds.push({
      id: "theme:toggle",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      group: "Preferences",
      keywords: "theme dark light",
      run: () => toggleTheme()
    });
    return cmds;
  }, [activeClusterId, clusters, navigate, theme, toggleTheme]);

  const filtered = useMemo<PaletteCommand[]>(() => {
    if (searchMode) {
      if (!activeClusterId) {
        return [];
      }
      return searchHits.slice(0, 50).map((hit, index) => ({
        id: `search:${index}:${hit.kind}:${hit.namespace ?? ""}:${hit.name}`,
        label: hit.name,
        hint: `${hit.kind}${hit.namespace ? ` · ${hit.namespace}` : ""}`,
        group: "Search Results",
        run: () => {
          const route = resourceConfigs.find((res) => res.resource === hit.resource && res.version === hit.apiVersion.split("/").pop());
          const target = route
            ? `/clusters/${activeClusterId}/${route.route}`
            : `/clusters/${activeClusterId}/resources?q=${encodeURIComponent(hit.resource)}`;
          navigate(target);
        }
      }));
    }
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.hint ?? ""} ${command.keywords ?? ""}`.toLowerCase();
      return q.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [activeClusterId, commands, navigate, query, searchHits, searchMode]);

  useEffect(() => {
    setSelected((prev) => (filtered.length === 0 ? 0 : Math.min(prev, filtered.length - 1)));
  }, [filtered]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-palette-index="${selected}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  function runSelected() {
    const command = filtered[selected];
    if (!command) return;
    setOpen(false);
    command.run();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[15vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close palette" />
      <div className="relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((prev) => (filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                runSelected();
              }
            }}
            type="text"
            placeholder="Type a command or search..."
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Command palette search"
          />
          <kbd className="hidden items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
            <Command className="h-3 w-3" />K
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {searchMode && searchQuery.length < 2
                ? "Type at least 2 characters to search resources..."
                : searchPending
                  ? "Searching..."
                  : "No matches."}
            </div>
          ) : (
            groupCommands(filtered).map((group) => (
              <div key={group.label}>
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</div>
                {group.items.map((command) => {
                  const index = filtered.indexOf(command);
                  const isSelected = index === selected;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      data-palette-index={index}
                      onMouseEnter={() => setSelected(index)}
                      onClick={() => {
                        setSelected(index);
                        runSelected();
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        isSelected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <span className="truncate">{command.label}</span>
                      {command.hint ? <span className="ml-3 truncate text-xs text-muted-foreground">{command.hint}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          <span>{searchMode ? "Searching cluster resources" : "Type / to search resources"} · Enter to run · Esc to close</span>
          <span>{filtered.length} result{filtered.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}

function groupCommands(commands: PaletteCommand[]) {
  const order: string[] = [];
  const map = new Map<string, PaletteCommand[]>();
  for (const command of commands) {
    if (!map.has(command.group)) {
      order.push(command.group);
      map.set(command.group, []);
    }
    map.get(command.group)!.push(command);
  }
  return order.map((label) => ({ label, items: map.get(label) ?? [] }));
}
