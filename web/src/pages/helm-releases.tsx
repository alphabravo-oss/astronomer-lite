import { Card } from "../components/ui/card";
import { PageHeader, PageShell } from "../components/ui/page";
import { DataTable, type Column } from "../components/ui/data-table";
import { Drawer } from "../components/ui/drawer";
import { Anchor, History, Package, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { HelmReleaseDetail, HelmReleaseSummary } from "../lib/api";
import { api, ApiError } from "../lib/api";
import {
  accessCheckFromSettled,
  accessStatusMessage,
  idleAccessCheck,
  isAccessBlocked,
  pendingAccessCheck,
  type AccessCheck,
} from "../lib/access";
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

function statusKind(status: string) {
  const s = status.toLowerCase();
  if (s === "deployed") return "success";
  if (s === "failed" || s === "superseded" || s === "uninstalling")
    return "error";
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
  const [actionState, setActionState] = useState<
    "idle" | "rolling-back" | "uninstalling"
  >("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rollbackAccess, setRollbackAccess] =
    useState<AccessCheck>(idleAccessCheck);
  const [uninstallAccess, setUninstallAccess] =
    useState<AccessCheck>(idleAccessCheck);

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
        if (!cancelled)
          setError(
            err instanceof ApiError ? err.message : (err as Error).message,
          );
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
      setRollbackAccess(idleAccessCheck);
      setUninstallAccess(idleAccessCheck);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setHistory([]);
    setActionMessage("");
    setDetailLoading(true);
    setRollbackAccess(pendingAccessCheck);
    setUninstallAccess(pendingAccessCheck);
    Promise.all([
      api.helmRelease(clusterId, selected.namespace, selected.name),
      api.helmReleaseHistory(clusterId, selected.namespace, selected.name),
    ])
      .then(([d, h]) => {
        if (cancelled) return;
        setDetail(d);
        setHistory(h.sort((a, b) => b.revision - a.revision));
      })
      .catch((err) => {
        if (!cancelled)
          setActionMessage(
            err instanceof Error ? err.message : "Failed to load release",
          );
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    void Promise.allSettled([
      api.canI(clusterId, {
        verb: "patch",
        group: "",
        resource: "secrets",
        namespace: selected.namespace,
      }),
      api.canI(clusterId, {
        verb: "delete",
        group: "",
        resource: "secrets",
        namespace: selected.namespace,
      }),
    ]).then(([patchResult, deleteResult]) => {
      if (cancelled) return;
      setRollbackAccess(accessCheckFromSettled(patchResult));
      setUninstallAccess(accessCheckFromSettled(deleteResult));
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
      await api.helmRollback(
        clusterId,
        selected.namespace,
        selected.name,
        revision,
      );
      setActionMessage(`Rolled back to revision ${revision}.`);
      await refresh();
      // Reload detail+history
      const [d, h] = await Promise.all([
        api.helmRelease(clusterId, selected.namespace, selected.name),
        api.helmReleaseHistory(clusterId, selected.namespace, selected.name),
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

  const canRollback = !isAccessBlocked(rollbackAccess);
  const canUninstall = !isAccessBlocked(uninstallAccess);
  const rollbackDeniedReason = accessStatusMessage(rollbackAccess);
  const uninstallDeniedReason = accessStatusMessage(uninstallAccess);

  const columns: Column<HelmReleaseSummary>[] = [
    {
      key: "name",
      header: "Name",
      textAccessor: (row) => row.name,
      accessor: (row) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <Package aria-hidden className="h-4 w-4 text-muted-foreground" />
          {row.name}
        </span>
      ),
    },
    { key: "namespace", header: "Namespace", accessor: (row) => row.namespace },
    {
      key: "chart",
      header: "Chart",
      accessor: (row) => `${row.chart} ${row.version}`,
    },
    { key: "app", header: "App", accessor: (row) => row.appVersion || "—" },
    { key: "revision", header: "Rev", accessor: (row) => row.revision },
    {
      key: "status",
      header: "Status",
      textAccessor: (row) => row.status,
      accessor: (row) => (
        <StatusBadge
          status={statusKind(row.status)}
          label={row.status}
          pulse={false}
          size="sm"
        />
      ),
    },
    {
      key: "updated",
      header: "Updated",
      sortAccessor: (row) => Date.parse(row.updated) || 0,
      accessor: (row) => ageOf(row.updated),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Helm Releases"
        description="Releases tracked by Helm v3 in this cluster."
        actions={
          <>
            <Link
              className="text-sm underline"
              to={`/clusters/${clusterId}/helm/install`}
            >
              Install chart
            </Link>
            <Button
              variant="secondary"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </>
        }
      />
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      <DataTable
        data={releases}
        columns={columns}
        keyExtractor={(row) => `${row.namespace}/${row.name}`}
        loading={loading}
        onRowClick={setSelected}
        searchPlaceholder="Filter releases…"
        emptyMessage="No Helm releases on this cluster."
      />

      {selected ? (
        <Drawer
          title={selected.name}
          onClose={() => setSelected(null)}
          className="max-w-2xl"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">
                {selected.name}
              </h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {selected.namespace} · {selected.chart} {selected.version}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                className="text-sm underline"
                to={`/clusters/${clusterId}/helm/releases/${encodeURIComponent(selected.namespace)}/${encodeURIComponent(selected.name)}/upgrade`}
              >
                Upgrade
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmUninstall(true)}
                disabled={actionState !== "idle" || !canUninstall}
                title={uninstallDeniedReason || undefined}
              >
                <Trash2 className="h-4 w-4" />
                Uninstall
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(null)}
              >
                Close
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {actionMessage ? (
              <div className="rounded-md border border-border bg-muted p-3 text-sm">
                {actionMessage}
              </div>
            ) : null}

            <Card as="section" className="bg-background">
              <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4" /> Revision History
              </h3>
              <div className="overflow-x-auto">
                <table className="k8s-table">
                  <thead className="k8s-thead">
                    <tr>
                      <th className="k8s-th">Rev</th>
                      <th className="k8s-th">Status</th>
                      <th className="k8s-th">Chart</th>
                      <th className="k8s-th">Updated</th>
                      <th className="k8s-th text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="k8s-td text-center text-muted-foreground"
                        >
                          {detailLoading ? "Loading..." : "No history."}
                        </td>
                      </tr>
                    ) : (
                      history.map((row) => (
                        <tr key={row.revision} className="k8s-row">
                          <td className="k8s-td font-mono">{row.revision}</td>
                          <td className="k8s-td">
                            <StatusBadge
                              status={statusKind(row.status)}
                              label={row.status}
                              pulse={false}
                              size="sm"
                            />
                          </td>
                          <td className="k8s-td font-mono text-muted-foreground">
                            {row.chart} {row.version}
                          </td>
                          <td className="k8s-td text-muted-foreground">
                            {ageOf(row.updated)}
                          </td>
                          <td className="k8s-td text-right">
                            {row.revision === selected.revision ? (
                              <span className="text-muted-foreground">
                                Current
                              </span>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void rollback(row.revision)}
                                disabled={
                                  actionState !== "idle" || !canRollback
                                }
                                title={rollbackDeniedReason || undefined}
                              >
                                {actionState === "rolling-back"
                                  ? "Rolling back..."
                                  : "Roll back"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {detail?.notes ? (
              <Card as="section" className="bg-background">
                <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">
                  <Anchor className="h-4 w-4" /> Notes
                </h3>
                <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                  {detail.notes}
                </pre>
              </Card>
            ) : null}

            <Card as="section" className="bg-background">
              <h3 className="mb-2 text-sm font-semibold">Values</h3>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-xs">
                {valuesYaml || "No values."}
              </pre>
            </Card>

            {detail?.manifest ? (
              <Card as="section" className="bg-background">
                <h3 className="mb-2 text-sm font-semibold">Manifest</h3>
                <pre className="max-h-96 overflow-auto whitespace-pre rounded-md bg-muted/40 p-3 font-mono text-xs">
                  {detail.manifest}
                </pre>
              </Card>
            ) : null}
          </div>
        </Drawer>
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
    </PageShell>
  );
}
