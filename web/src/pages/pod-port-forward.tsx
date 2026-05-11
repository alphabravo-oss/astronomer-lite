import { ArrowLeft, Copy, ExternalLink, Plug, RefreshCcw, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ActionMenu } from "../components/ui/action-menu";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { PodDetail, PortForward } from "../lib/api";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

export function PodPortForwardPage() {
  const { clusterId = "", namespace = "", name = "" } = useParams();
  const location = useLocation();
  const decodedNamespace = decodeURIComponent(namespace);
  const decodedName = decodeURIComponent(name);
  const targetKind = location.pathname.includes("/services/") ? "service" : "pod";
  const requestedPort = Number(new URLSearchParams(location.search).get("port") || 0);
  const [detail, setDetail] = useState<PodDetail | null>(null);
  const [serviceDetail, setServiceDetail] = useState<Record<string, unknown> | null>(null);
  const [remotePort, setRemotePort] = useState(Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 80);
  const [localPort, setLocalPort] = useState(0);
  const [sessions, setSessions] = useState<PortForward[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const suggestedPorts = useMemo(() => (targetKind === "service" ? extractServicePorts(serviceDetail) : extractContainerPorts(detail)), [detail, serviceDetail, targetKind]);

  const loadSessions = useCallback(async () => {
    if (!clusterId) return;
    setLoading(true);
    try {
      const rows = await api.portForwards(clusterId);
      setSessions(
        rows.filter((row) => {
          const rowKind = row.resourceKind || "pod";
          const rowName = row.resourceName || row.pod;
          return row.namespace === decodedNamespace && rowKind === targetKind && rowName === decodedName;
        })
      );
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load port-forwards");
    } finally {
      setLoading(false);
    }
  }, [clusterId, decodedName, decodedNamespace, targetKind]);

  useEffect(() => {
    if (!clusterId || !decodedNamespace || !decodedName) return;
    let cancelled = false;
    const request =
      targetKind === "service"
        ? api.resourceDetail(clusterId, "services", decodedNamespace, decodedName)
        : api.podDetail(clusterId, decodedNamespace, decodedName);
    request.then((nextDetail) => {
      if (cancelled) return;
      if (targetKind === "service") {
        setServiceDetail(nextDetail);
        const firstPort = extractServicePorts(nextDetail)[0];
        if (!requestedPort && firstPort) setRemotePort(firstPort);
      } else {
        setDetail(nextDetail as PodDetail);
        const firstPort = extractContainerPorts(nextDetail as PodDetail)[0];
        if (!requestedPort && firstPort) setRemotePort(firstPort);
      }
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : `Failed to load ${targetKind} detail`);
    });
    return () => {
      cancelled = true;
    };
  }, [clusterId, decodedName, decodedNamespace, requestedPort, targetKind]);

  useEffect(() => {
    void loadSessions();
    const timer = window.setInterval(() => void loadSessions(), 5_000);
    return () => window.clearInterval(timer);
  }, [loadSessions]);

  async function startForward() {
    setStarting(true);
    setError("");
    try {
      const session =
        targetKind === "service"
          ? await api.startServicePortForward(clusterId, decodedNamespace, decodedName, remotePort, localPort)
          : await api.startPortForward(clusterId, decodedNamespace, decodedName, remotePort, localPort);
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start port-forward");
    } finally {
      setStarting(false);
    }
  }

  async function stopForward(sessionId: string) {
    try {
      await api.stopPortForward(clusterId, sessionId);
      setSessions((current) => current.filter((item) => item.id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop port-forward");
    }
  }

  async function copyForwardUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy URL");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <Link to={`/clusters/${clusterId}/${targetKind === "service" ? "services" : "pods"}`} className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {targetKind === "service" ? "Services" : "Pods"}
          </Link>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{decodedName}</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{decodedNamespace}</p>
        </div>
        <Button variant="secondary" onClick={() => void loadSessions()} disabled={loading}>
          <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase text-muted-foreground">Remote {targetKind} port</span>
            <Input
              id={`${targetKind}-remote-port`}
              name={`${targetKind}-remote-port`}
              type="number"
              min={1}
              max={65535}
              value={remotePort}
              onChange={(event) => setRemotePort(Number(event.target.value) || 0)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase text-muted-foreground">Local port</span>
            <Input
              id={`${targetKind}-local-port`}
              name={`${targetKind}-local-port`}
              type="number"
              min={0}
              max={65535}
              value={localPort}
              onChange={(event) => setLocalPort(Number(event.target.value) || 0)}
            />
            <span className="text-xs text-muted-foreground">Use 0 to assign a free local port.</span>
          </label>
          <Button onClick={() => void startForward()} disabled={starting || remotePort <= 0}>
            <Plug className="h-4 w-4" />
            {starting ? "Starting..." : "Start"}
          </Button>
        </div>
        {suggestedPorts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestedPorts.map((port) => (
              <button
                key={port}
                type="button"
                className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setRemotePort(port)}
              >
                {port}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Active port-forwards</h2>
        </div>
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Local URL</th>
              <th className="px-4 py-3 font-medium">Remote</th>
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs">
                  <a href={session.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-foreground hover:underline">
                    {session.url}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{session.remotePort}</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(session.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "-"}
                </td>
                <td className="px-4 py-3">
                  <ActionMenu
                    label={`Open ${(session.resourceName || session.pod)} port-forward actions`}
                    items={[
                      {
                        label: "Open URL",
                        icon: <ExternalLink className="h-3.5 w-3.5" />,
                        onClick: () => window.open(session.url, "_blank", "noopener,noreferrer")
                      },
                      {
                        label: "Copy URL",
                        icon: <Copy className="h-3.5 w-3.5" />,
                        onClick: () => void copyForwardUrl(session.url)
                      },
                      {
                        label: "Stop",
                        icon: <Square className="h-3.5 w-3.5" />,
                        onClick: () => void stopForward(session.id),
                        variant: "destructive",
                        separator: true
                      }
                    ]}
                  />
                </td>
              </tr>
            ))}
            {sessions.length === 0 ? (
              <tr>
                <td className="bg-card px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                  No active port-forwards for this {targetKind}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function extractContainerPorts(detail: PodDetail | null) {
  if (!detail) return [];
  const values = new Set<number>();
  for (const container of detail.containers) {
    for (const port of container.ports ?? []) {
      if (typeof port === "number") values.add(port);
    }
  }
  return Array.from(values).sort((a, b) => a - b);
}

function extractServicePorts(detail: Record<string, unknown> | null) {
  const spec = detail?.spec;
  if (!spec || typeof spec !== "object") return [];
  const ports = (spec as { ports?: unknown }).ports;
  if (!Array.isArray(ports)) return [];
  const values = new Set<number>();
  for (const item of ports) {
    if (!item || typeof item !== "object") continue;
    const port = (item as { port?: unknown }).port;
    if (typeof port === "number") values.add(port);
  }
  return Array.from(values).sort((a, b) => a - b);
}
