import { Anchor, History, Package, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { AccessReviewResponse, HelmReleaseDetail, HelmReleaseSummary } from "../lib/api";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { StatusBadge } from "../components/ui/status-badge";

function ageOf(updated: string) {
  if (!updated) return "-";
  const d = new Date(updated);
  if (Number.isNaN(d.getTime())) return updated;
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function accessDeniedReason(response: AccessReviewResponse | null, label: string) {
  if (!response) return `Cannot ${label} in this namespace.`;
  if (response.allowed && !response.denied) return "";
  const reason = response.reason?.trim();
  return reason ? `Cannot ${label}: ${reason}` : `Cannot ${label} in this namespace.`;
}

function statusKind(status: string) {
  const s = status.toLowerCase();
  if (s === "deployed") return "success";
  if (s === "failed" || s === "superseded" || s === "uninstalling") return "error";
  if (s.startsWith("pending") || s === "unknown") return "warning";
  return "unknown";
}

export function HelmReleasesPage() {
  const { clusterId = "" } = useParams();
  const [releases, setReleases] = useState<HelmReleaseSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<HelmReleaseSummary | null>(null);
  const [detail, setDetail] = useState<HelmReleaseDetail | null>(null);
  const [history, setHistory] = useState<HelmReleaseSummary[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionState, setActionState] = useState<"idle" | "rolling-back" | "uninstalling">("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rollbackAccess, setRollbackAccess] = useState<AccessReviewResponse | null>(null);
  const [uninstallAccess, setUninstallAccess] = useState<AccessReviewResponse | null>(null);
  const [accessChecking, setAccessChecking] = useState(false);

  useEffect(() => {
    if (!clusterId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .helmReleases(clusterId)
      .then((next) => {
        if (!cancelled) setReleases(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : (err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, refreshKey]);

  async function refresh() {
    setRefreshKey((value) => value + 1);
  }

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setHistory([]);
      setRollbackAccess(null);
      setUninstallAccess(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([
      api.helmRelease(clusterId, selected.namespace, selected.name),
      api.helmReleaseHistory(clusterId, selected.namespace, selected.name)
    ])
      .then(([d, h]) => {
        if (cancelled) return;
        setDetail(d);
        setHistory(h.sort((a, b) => b.revision - a.revision));
      })
      .catch((err) => {
        if (!cancelled) setActionMessage(err instanceof Error ? err.message : "Failed to load release");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, selected]);

  useEffect(() => {
    if (!selected) {
      setRollbackAccess(null);
      setUninstallAccess(null);
      return;
    }
    let cancelled = false;
    setAccessChecking(true);
    setRollbackAccess(null);
    setUninstallAccess(null);
    void Promise.allSettled([
      api.canI(clusterId, { verb: "patch", group: "", resource: "secrets", namespace: selected.namespace }),
      api.canI(clusterId, { verb: "delete", group: "", resource: "secrets", namespace: selected.namespace })
    ]).then(([patchResult, deleteResult]) => {
      if (cancelled) return;
      setRollbackAccess(patchResult.status === "fulfilled" ? patchResult.value : null);
      setUninstallAccess(deleteResult.status === "fulfilled" ? deleteResult.value : null);
      setAccessChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clusterId, selected]);

  async function rollback(revision: number) {
    if (!selected) return;
    setActionState("rolling-back");
    setActionMessage("");
    try {
      await api.helmRollback(clusterId, selected.namespace, selected.name, revision);
      setActionMessage(`Rolled back to revision ${revision}.`);
      await refresh();
      // Reload detail+history
      const [d, h] = await Promise.all([
        api.helmRelease(clusterId, selected.namespace, selected.name),
        api.helmReleaseHistory(clusterId, selected.namespace, selected.name)
      ]);
      setDetail(d);
      setHistory(h.sort((a, b) => b.revision - a.revision));
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setActionState("idle");
    }
  }

  async function uninstall() {
    if (!selected) return;
    setActionState("uninstalling");
    setActionMessage("");
    try {
      await api.helmUninstall(clusterId, selected.namespace, selected.name);
      setActionMessage(`Uninstalled ${selected.name}.`);
      setSelected(null);
      setDetail(null);
      setHistory([]);
      await refresh();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Uninstall failed");
    } finally {
      setActionState("idle");
      setConfirmUninstall(false);
    }
  }

  const valuesYaml = useMemo(() => {
    if (!detail?.values) return "";
    try {
      return JSON.stringify(detail.values, null, 2);
    } catch {
      return "";
    }
  }, [detail]);

  const canRollback = rollbackAccess?.allowed === true && rollbackAccess?.denied !== true;
  const canUninstall = uninstallAccess?.allowed === true && uninstallAccess?.denied !== true;
  const rollbackDeniedReason = accessDeniedReason(rollbackAccess, "patch secrets");
  const uninstallDeniedReason = accessDeniedReason(uninstallAccess, "delete secrets");

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Helm Releases</h1>
          <p className="mt-1 text-sm text-muted-foreground">Releases tracked by Helm v3 in this cluster.</p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Namespace</th>
              <th className="px-4 py-3 font-medium">Chart</th>
              <th className="px-4 py-3 font-medium">App</th>
              <th className="px-4 py-3 font-medium">Rev</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {releases.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-muted-foreground" colSpan={7}>
                  {loading ? "Loading releases..." : "No Helm releases on this cluster."}
                </td>
              </tr>
            ) : (
              releases.map((rel) => (
                <tr
                  key={`${rel.namespace}/${rel.name}/${rel.revision}`}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-muted/50"
                  onClick={() => setSelected(rel)}
                >
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      {rel.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{rel.namespace}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{rel.chart} {rel.version}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{rel.appVersion || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{rel.revision}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={statusKind(rel.status)} label={rel.status} pulse={false} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{ageOf(rel.updated)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-card shadow-xl">
          <div className="flex items-start justify-between border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {selected.namespace} · {selected.chart} {selected.version}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmUninstall(true)}
                disabled={actionState !== "idle" || accessChecking || !canUninstall}
                title={
                  accessChecking
                    ? "Checking Kubernetes authorization..."
                    : !canUninstall
                      ? uninstallDeniedReason
                      : undefined
                }
              >
                <Trash2 className="h-4 w-4" />
                Uninstall
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {actionMessage ? <div className="rounded-md border border-border bg-muted p-3 text-sm">{actionMessage}</div> : null}

            <section className="rounded-lg border border-border bg-background p-4">
              <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4" /> Revision History
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Rev</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Chart</th>
                      <th className="py-2 pr-4 font-medium">Updated</th>
                      <th className="py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-muted-foreground">
                          {detailLoading ? "Loading..." : "No history."}
                        </td>
                      </tr>
                    ) : (
                      history.map((row) => (
                        <tr key={row.revision} className="border-t border-border/50">
                          <td className="py-2 pr-4 font-mono">{row.revision}</td>
                          <td className="py-2 pr-4">
                            <StatusBadge status={statusKind(row.status)} label={row.status} pulse={false} size="sm" />
                          </td>
                          <td className="py-2 pr-4 font-mono text-muted-foreground">{row.chart} {row.version}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{ageOf(row.updated)}</td>
                          <td className="py-2 text-right">
                            {row.revision === selected.revision ? (
                              <span className="text-muted-foreground">Current</span>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void rollback(row.revision)}
                                disabled={actionState !== "idle" || accessChecking || !canRollback}
                                title={
                                  accessChecking
                                    ? "Checking Kubernetes authorization..."
                                    : !canRollback
                                      ? rollbackDeniedReason
                                      : undefined
                                }
                              >
                                {actionState === "rolling-back" ? "Rolling back..." : "Roll back"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {detail?.notes ? (
              <section className="rounded-lg border border-border bg-background p-4">
                <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">
                  <Anchor className="h-4 w-4" /> Notes
                </h3>
                <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{detail.notes}</pre>
              </section>
            ) : null}

            <section className="rounded-lg border border-border bg-background p-4">
              <h3 className="mb-2 text-sm font-semibold">Values</h3>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-xs">
                {valuesYaml || "No values."}
              </pre>
            </section>

            {detail?.manifest ? (
              <section className="rounded-lg border border-border bg-background p-4">
                <h3 className="mb-2 text-sm font-semibold">Manifest</h3>
                <pre className="max-h-96 overflow-auto whitespace-pre rounded-md bg-muted/40 p-3 font-mono text-xs">{detail.manifest}</pre>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmUninstall && selected !== null}
        onClose={() => setConfirmUninstall(false)}
        onConfirm={() => void uninstall()}
        title="Uninstall release"
        description={
          selected
            ? `Uninstall the Helm release "${selected.name}" from namespace "${selected.namespace}". This deletes all of its managed resources.`
            : ""
        }
        confirmText="Uninstall"
        confirmValue={selected?.name}
        variant="destructive"
        loading={actionState === "uninstalling"}
      />
    </div>
  );
}
