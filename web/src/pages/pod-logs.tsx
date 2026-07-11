import { ArrowLeft, Download, Pin, PinOff, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PageHeader, PageShell } from "../components/ui/page";
import { logActivityId, useActivities } from "../lib/activities-context";
import type { PodDetail } from "../lib/api";
import { api } from "../lib/api";
import {
  logStreamId,
  startLogStream,
  stopLogStream,
  subscribeLogStream,
  type LogStreamSnapshot
} from "../lib/log-streams";
import { cn } from "../lib/utils";

export function PodLogsPage() {
  const { clusterId = "", namespace = "", name = "" } = useParams();
  const decodedNamespace = decodeURIComponent(namespace);
  const decodedName = decodeURIComponent(name);
  const [detail, setDetail] = useState<PodDetail | null>(null);
  const [container, setContainer] = useState("");
  const [tailLines, setTailLines] = useState(100);
  const [follow, setFollow] = useState(true);
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "complete" | "reconnecting" | "error">("connecting");
  const [error, setError] = useState("");
  const [restartKey, setRestartKey] = useState(0);
  const viewportRef = useRef<HTMLPreElement | null>(null);
  const location = useLocation();
  const { pin, unpin, hasActivity, getActivity } = useActivities();
  const dockId = logActivityId({ clusterId, namespace: decodedNamespace, pod: decodedName });
  const pinned = hasActivity(dockId);
  const pinnedActivity = pinned ? getActivity(dockId) : undefined;
  // Read pinned via a ref inside the effect's cleanup so toggling pin
  // does NOT re-run the effect (which would otherwise stop+restart the
  // WS and lose the buffer).
  const pinnedRef = useRef(pinned);
  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);
  // When pinned, the dock owns the active container; locking the dropdown
  // avoids fighting the buffer.
  const activeContainer = pinnedActivity?.logStream?.container ?? container;
  const streamKey = activeContainer
    ? logStreamId({ clusterId, namespace: decodedNamespace, pod: decodedName, container: activeContainer })
    : "";

  function toggleDock() {
    if (pinned) {
      unpin(dockId);
      return;
    }
    if (!container) return;
    pin({
      id: dockId,
      kind: "logs",
      label: decodedName,
      detail: `Logs · ${decodedNamespace}`,
      href: `${location.pathname}${location.search}`,
      logStream: { clusterId, namespace: decodedNamespace, pod: decodedName, container, tailLines }
    });
  }

  useEffect(() => {
    if (!clusterId || !decodedNamespace || !decodedName) return;
    let cancelled = false;
    api
      .podDetail(clusterId, decodedNamespace, decodedName)
      .then((nextDetail) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setContainer((current) => current || nextDetail.containers[0]?.name || "");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load pod detail");
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, decodedName, decodedNamespace]);

  // Single subscription path: always go through the persistent stream store.
  // If the activity isn't pinned, the page owns the stream's lifecycle and
  // tears it down on unmount. If it is pinned, the activity provider keeps
  // the stream alive across navigation and we only subscribe.
  useEffect(() => {
    if (!clusterId || !decodedNamespace || !decodedName || !activeContainer || !streamKey) return;
    startLogStream({
      clusterId,
      namespace: decodedNamespace,
      pod: decodedName,
      container: activeContainer,
      tailLines,
      follow
    });
    const unsubscribe = subscribeLogStream(streamKey, (snap: LogStreamSnapshot) => {
      setStatus(snap.status);
      setError(snap.error);
      setLines(snap.entries.map((entry) => entry.message));
    });
    return () => {
      unsubscribe();
      if (!pinnedRef.current) stopLogStream(streamKey);
    };
  }, [activeContainer, clusterId, decodedName, decodedNamespace, follow, restartKey, streamKey, tailLines]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !follow) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [follow, lines]);

  const logText = useMemo(() => lines.join("\n"), [lines]);

  function downloadLogs() {
    const blob = new Blob([logText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const parts = [decodedNamespace, decodedName, activeContainer, stamp].filter(Boolean);
    link.download = `${parts.join("-")}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function reconnect() {
    if (streamKey) stopLogStream(streamKey);
    setRestartKey((value) => value + 1);
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        eyebrow={
          <Link to={`/clusters/${clusterId}/pods`} className="inline-flex items-center gap-2 normal-case tracking-normal text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Pods
          </Link>
        }
        title={decodedName}
        description={<span className="font-mono">{decodedNamespace}</span>}
        actions={
          <>
            <Button variant="secondary" onClick={reconnect}>
              <RefreshCcw className={cn("h-4 w-4", status === "connecting" && "animate-spin")} />
              Reconnect
            </Button>
            <Button variant="secondary" onClick={downloadLogs} disabled={lines.length === 0}>
              <Download className="h-4 w-4" />
              Download
            </Button>
            <Button variant="secondary" onClick={toggleDock} aria-pressed={pinned}>
              {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              {pinned ? "Unpin" : "Pin to dock"}
            </Button>
          </>
        }
      />

      {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}

      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium uppercase text-muted-foreground">Container</span>
          <select
            value={activeContainer}
            onChange={(event) => setContainer(event.target.value)}
            disabled={pinned}
            className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
          >
            {(detail?.containers ?? []).map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium uppercase text-muted-foreground">Tail</span>
          <Input
            type="number"
            min={0}
            value={tailLines}
            onChange={(event) => setTailLines(Math.max(0, Number(event.target.value) || 0))}
            className="w-28"
          />
        </label>
        <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} disabled={pinned} />
          Follow
        </label>
        <div className="ml-auto text-xs uppercase text-muted-foreground">{status}</div>
      </section>

      <pre
        ref={viewportRef}
        className="h-[calc(100vh-20rem)] min-h-96 overflow-auto rounded-lg border border-border bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-100"
      >
        {logText || (status === "connecting" ? "Connecting to log stream..." : "No log lines.")}
      </pre>
    </PageShell>
  );
}
