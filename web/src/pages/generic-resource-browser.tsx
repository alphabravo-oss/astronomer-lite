import { Check, FileUp, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PageHeader, PageShell } from "../components/ui/page";
import type { ApplyResponse, DiscoveredResource } from "../lib/api";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { ResourceListPage } from "./resource-list";

type GenericResourceBrowserProps = {
  selectedNamespaces: string[];
};

export function GenericResourceBrowser({ selectedNamespaces }: GenericResourceBrowserProps) {
  const { clusterId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [resources, setResources] = useState<DiscoveredResource[]>([]);
  const [selected, setSelected] = useState<DiscoveredResource | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [applyYaml, setApplyYaml] = useState("");
  const [validatedYaml, setValidatedYaml] = useState("");
  const [applyState, setApplyState] = useState<"idle" | "dry-running" | "applying">("idle");
  const [applyError, setApplyError] = useState("");
  const [applyResponse, setApplyResponse] = useState<ApplyResponse | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (!clusterId) return;
    let cancelled = false;
    api
      .discovery(clusterId)
      .then((data) => {
        if (!cancelled) {
          const requested = searchParams.get("q")?.trim().toLowerCase() ?? "";
          const queryMatch = requested
            ? data.find((resource) =>
                [resource.kind, resource.resource, resource.groupVersion]
                  .join(" ")
                  .toLowerCase()
                  .includes(requested)
              )
            : null;
          setResources(data);
          setSelected(
            (current) =>
              current ??
              queryMatch ??
              data.find((resource) => resource.group === "" && resource.version === "v1" && resource.resource === "pods") ??
              data[0] ??
              null
          );
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to discover API resources");
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, searchParams]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return resources;
    return resources.filter((resource) =>
      [resource.kind, resource.resource, resource.groupVersion]
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }, [query, resources]);

  useEffect(() => {
    const value = query.trim();
    if (!value || filtered.length === 0) return;
    if (!selected || !filtered.some((resource) => resource.groupVersion === selected.groupVersion && resource.resource === selected.resource)) {
      setSelected(filtered[0]);
    }
  }, [filtered, query, selected]);

  const canApplyValidatedYaml = validatedYaml !== "" && applyYaml === validatedYaml;

  function updateApplyYaml(value: string) {
    setApplyYaml(value);
    setValidatedYaml("");
    setApplyResponse(null);
    setApplyError("");
  }

  async function dryRunApplyYaml() {
    if (!clusterId || !applyYaml.trim()) return;
    setApplyState("dry-running");
    setApplyError("");
    try {
      const response = await api.applyManifests(clusterId, applyYaml, true);
      setApplyResponse(response);
      setValidatedYaml(applyYaml);
    } catch (err) {
      setApplyResponse(null);
      setValidatedYaml("");
      setApplyError(err instanceof Error ? err.message : "Failed to dry-run manifests");
    } finally {
      setApplyState("idle");
    }
  }

  async function applyValidatedYaml() {
    if (!clusterId || !canApplyValidatedYaml) return;
    setApplyState("applying");
    setApplyError("");
    try {
      const response = await api.applyManifests(clusterId, applyYaml, false);
      setApplyResponse(response);
      setValidatedYaml("");
      setApplyYaml("");
      setRefreshSignal((value) => value + 1);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to apply manifests");
    } finally {
      setApplyState("idle");
    }
  }

  return (
    <PageShell>
      <PageHeader title="API Resources" description="Discovery-backed browser for any listable Kubernetes GVR." />

      {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Apply YAML</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Paste one or more Kubernetes YAML documents and run a server-side dry run before applying.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void dryRunApplyYaml()}
              disabled={applyState !== "idle" || !applyYaml.trim()}
            >
              {applyState === "dry-running" ? "Dry-running..." : "Dry run"}
            </Button>
            <Button size="sm" onClick={() => void applyValidatedYaml()} disabled={applyState !== "idle" || !canApplyValidatedYaml}>
              {applyState === "applying" ? "Applying..." : "Apply"}
            </Button>
          </div>
        </div>
        <textarea
          id="apply-yaml"
          name="apply-yaml"
          value={applyYaml}
          onChange={(event) => updateApplyYaml(event.target.value)}
          placeholder={"apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: example\n  namespace: default\n---"}
          className="min-h-44 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />
        {applyError ? (
          <div className="mt-3 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{applyError}</div>
        ) : null}
        {applyResponse ? (
          <div
            className={cn(
              "mt-3 rounded-md border p-3 text-sm",
              applyResponse.dryRun ? "border-status-warning/35 bg-status-warning/10 text-status-warning" : "border-status-success/35 bg-status-success/10 text-status-success"
            )}
          >
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Check className="h-4 w-4" />
              {applyResponse.dryRun ? "Dry run passed" : "Applied"} for {applyResponse.items.length} resource{applyResponse.items.length === 1 ? "" : "s"}.
            </div>
            <div className="flex flex-wrap gap-2">
              {applyResponse.items.map((item) => (
                <span key={`${item.apiVersion}/${item.kind}/${item.namespace ?? "_cluster"}/${item.name}`} className="rounded-md bg-background/70 px-2 py-1 font-mono text-xs">
                  {item.kind}/{item.namespace ? `${item.namespace}/` : ""}{item.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input id="api-resource-filter" name="api-resource-filter" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Filter resources" />
            </div>
          </div>
          <div className="max-h-[640px] overflow-y-auto p-2">
            {filtered.map((resource) => (
              <button
                key={`${resource.groupVersion}/${resource.resource}`}
                type="button"
                className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                  selected?.groupVersion === resource.groupVersion && selected.resource === resource.resource
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground"
                }`}
                onClick={() => setSelected(resource)}
              >
                <div className="font-medium text-foreground">{resource.kind || resource.resource}</div>
                <div className="mt-0.5 truncate font-mono text-2xs">
                  {resource.groupVersion}/{resource.resource}
                </div>
              </button>
            ))}
            {filtered.length === 0 ? <div className="px-3 py-8 text-center text-sm text-muted-foreground">No API resources found.</div> : null}
          </div>
        </aside>

        <div className="min-w-0">
          {selected ? (
            <ResourceListPage
              key={`${selected.groupVersion}/${selected.resource}`}
              selectedNamespaces={selectedNamespaces}
              discoveredResource={selected}
              refreshSignal={refreshSignal}
            />
          ) : (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              Select an API resource.
            </div>
          )}
        </div>
      </section>
    </PageShell>
  );
}
