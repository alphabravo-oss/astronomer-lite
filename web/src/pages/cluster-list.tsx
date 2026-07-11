import { Activity, AlertTriangle, Plus, Server, Upload, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Cluster, KubeconfigContextPreview } from "../lib/api";
import { api } from "../lib/api";
import { clusterStatus } from "../lib/cluster";
import { ClusterCard } from "../components/clusters/cluster-card";
import { ClusterDisplayDialog } from "../components/clusters/cluster-display-dialog";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Textarea } from "../components/ui/input";
import { MetricCard } from "../components/ui/metric-card";
import { PageHeader, PageShell } from "../components/ui/page";

type ClusterListProps = {
  clusters: Cluster[];
  onRefresh: () => Promise<void>;
};

export function ClusterList({ clusters, onRefresh }: ClusterListProps) {
  const [yaml, setYaml] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [addError, setAddError] = useState("");
  const [pageError, setPageError] = useState("");
  const [contextPreview, setContextPreview] = useState<KubeconfigContextPreview[]>([]);
  const [selectedContexts, setSelectedContexts] = useState<string[]>([]);
  const [removeTarget, setRemoveTarget] = useState<Cluster | null>(null);
  const [customizeTarget, setCustomizeTarget] = useState<Cluster | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reachableCount = clusters.filter((cluster) => clusterStatus(cluster) === "reachable").length;
  const degradedCount = clusters.filter((cluster) => clusterStatus(cluster) === "degraded").length;
  const unreachableCount = clusters.filter((cluster) => clusterStatus(cluster) === "unreachable").length;

  async function addKubeconfig() {
    setBusy(true);
    setAddError("");
    setPageError("");
    try {
      await api.addKubeconfig(yaml, selectedContexts);
      setYaml("");
      setContextPreview([]);
      setSelectedContexts([]);
      setAddOpen(false);
      await onRefresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add kubeconfig");
    } finally {
      setBusy(false);
    }
  }

  async function previewKubeconfig() {
    setPreviewBusy(true);
    setAddError("");
    try {
      const response = await api.previewKubeconfig(yaml);
      setContextPreview(response.contexts);
      const importableContexts = response.contexts.filter((context) => !context.alreadyExists).map((context) => context.name);
      setSelectedContexts(importableContexts);
      if (response.contexts.length === 0) {
        setAddError("No valid contexts found in this kubeconfig.");
      } else if (importableContexts.length === 0) {
        setAddError("All contexts in this kubeconfig already exist.");
      }
    } catch (err) {
      setContextPreview([]);
      setSelectedContexts([]);
      setAddError(err instanceof Error ? err.message : "Failed to preview kubeconfig");
    } finally {
      setPreviewBusy(false);
    }
  }

  function updateYaml(value: string) {
    setYaml(value);
    setContextPreview([]);
    setSelectedContexts([]);
    setAddError("");
  }

  async function remove(id: string) {
    setBusy(true);
    setPageError("");
    try {
      await api.removeCluster(id);
      setRemoveTarget(null);
      await onRefresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to remove cluster");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Clusters"
        description="Kubeconfig contexts available to this single-container console."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add kubeconfig
          </Button>
        }
      />

      {pageError ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{pageError}</div> : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Total Clusters" value={clusters.length} icon={<Server className="h-4 w-4" />} />
        <MetricCard
          title="Reachable"
          value={reachableCount}
          subtitle={`${clusters.length > 0 ? Math.round((reachableCount / clusters.length) * 100) : 0}% healthy`}
          icon={<Activity className="h-4 w-4" />}
        />
        <MetricCard title="Degraded" value={degradedCount} icon={<AlertTriangle className="h-4 w-4" />} />
        <MetricCard title="Unreachable" value={unreachableCount} icon={<WifiOff className="h-4 w-4" />} />
      </section>

      {clusters.length > 0 ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {clusters.map((cluster) => (
            <ClusterCard key={cluster.id} cluster={cluster} busy={busy} onRemove={setRemoveTarget} onCustomize={setCustomizeTarget} />
          ))}
        </section>
      ) : (
        <section className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/40 px-6 py-10 text-center">
          <Server className="mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">No kubeconfig contexts found.</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Add a kubeconfig to connect this single-container console to a remote cluster.</p>
          <Button className="mt-4" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add kubeconfig
          </Button>
        </section>
      )}

      <AddKubeconfigDialog
        open={addOpen}
        busy={busy}
        previewBusy={previewBusy}
        error={addError}
        fileRef={fileRef}
        yaml={yaml}
        contexts={contextPreview}
        selectedContexts={selectedContexts}
        onYamlChange={updateYaml}
        onSelectedContextsChange={setSelectedContexts}
        onClose={() => {
          if (busy) return;
          setAddOpen(false);
          setAddError("");
        }}
        onPreview={() => void previewKubeconfig()}
        onSubmit={addKubeconfig}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => {
          if (busy) return;
          setRemoveTarget(null);
        }}
        onConfirm={() => {
          if (removeTarget) void remove(removeTarget.id);
        }}
        title="Remove kubeconfig"
        description={
          removeTarget
            ? `Remove the app-managed kubeconfig for "${removeTarget.name}". This only removes this console's managed copy.`
            : "Remove this app-managed kubeconfig."
        }
        confirmText="Remove"
        confirmValue={removeTarget?.name}
        variant="destructive"
        loading={busy}
      />

      <ClusterDisplayDialog cluster={customizeTarget} onClose={() => setCustomizeTarget(null)} onSaved={() => void onRefresh()} />
    </PageShell>
  );
}

type AddKubeconfigDialogProps = {
  open: boolean;
  busy: boolean;
  previewBusy: boolean;
  error: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  yaml: string;
  contexts: KubeconfigContextPreview[];
  selectedContexts: string[];
  onYamlChange: (value: string) => void;
  onSelectedContextsChange: (value: string[]) => void;
  onClose: () => void;
  onPreview: () => void;
  onSubmit: () => void;
};

function AddKubeconfigDialog({
  open,
  busy,
  previewBusy,
  error,
  fileRef,
  yaml,
  contexts,
  selectedContexts,
  onYamlChange,
  onSelectedContextsChange,
  onClose,
  onPreview,
  onSubmit,
}: AddKubeconfigDialogProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, open]);

  if (!open) return null;
  const selectedImportableContexts = selectedContexts.filter((name) => contexts.some((context) => context.name === name && !context.alreadyExists));
  const canAdd = yaml.trim() !== "" && contexts.length > 0 && selectedImportableContexts.length > 0;

  function toggleContext(name: string) {
    if (selectedContexts.includes(name)) {
      onSelectedContextsChange(selectedContexts.filter((contextName) => contextName !== name));
    } else {
      onSelectedContextsChange([...selectedContexts, name]);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} aria-label="Close dialog" />
      <section className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold">
              <Upload className="h-4 w-4" />
              Add kubeconfig
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Paste or upload kubeconfig YAML to add app-managed contexts.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="Close add kubeconfig dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-6">
          <Textarea
            id="kubeconfig-yaml"
            name="kubeconfig-yaml"
            value={yaml}
            onChange={(event) => onYamlChange(event.target.value)}
            placeholder="apiVersion: v1&#10;kind: Config&#10;clusters: ..."
            aria-label="Kubeconfig YAML"
            autoFocus
          />
          {contexts.length > 0 ? (
            <section className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold">Contexts</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{selectedContexts.length} of {contexts.length} selected for import.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectedContextsChange(contexts.filter((context) => !context.alreadyExists).map((context) => context.name))}
                    disabled={busy}
                  >
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onSelectedContextsChange([])} disabled={busy}>
                    Clear
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-border">
                {contexts.map((context) => (
                  <label key={context.name} className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/50">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-input"
                      checked={selectedContexts.includes(context.name)}
                      disabled={busy || context.alreadyExists}
                      onChange={() => toggleContext(context.name)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-foreground">{context.name}</span>
                        {context.current ? <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">current</span> : null}
                        {context.alreadyExists ? <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">already added</span> : null}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{context.server}</span>
                      <span className="mt-1 block truncate text-2xs text-muted-foreground">
                        cluster: {context.cluster}{context.user ? ` / user: ${context.user}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}
          <input
            ref={fileRef}
            id="kubeconfig-file"
            name="kubeconfig-file"
            type="file"
            accept=".yaml,.yml,.conf"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) onYamlChange(await file.text());
            }}
          />
          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4" />
            Upload file
          </Button>
          <Button variant="secondary" onClick={onPreview} disabled={busy || previewBusy || yaml.trim() === ""}>
            {previewBusy ? "Previewing..." : "Preview contexts"}
          </Button>
          <Button onClick={onSubmit} disabled={busy || !canAdd}>
            Add selected
          </Button>
        </div>
      </section>
    </div>
  );
}
