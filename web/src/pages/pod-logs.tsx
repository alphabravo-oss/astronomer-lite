import { ArrowLeft, Download, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { LogFrame, PodDetail } from "../lib/api";
import { api } from "../lib/api";
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
  const latestTimestampRef = useRef("");
  const seenLogFramesRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!clusterId || !decodedNamespace || !decodedName) return;
    let closed = false;
    let retryTimer: number | undefined;
    let socket: WebSocket | undefined;
    latestTimestampRef.current = "";
    seenLogFramesRef.current = new Set();
    setLines([]);
    setError("");
    setStatus("connecting");

    const connect = () => {
      const sinceTime = latestTimestampRef.current;
      const ws = new WebSocket(api.podLogsUrl(clusterId, decodedNamespace, decodedName, container, tailLines, follow, { sinceTime, timestamps: true }));
      socket = ws;
      ws.onopen = () => {
        if (!closed) setStatus("connected");
      };
      ws.onmessage = (event) => {
        const frame = JSON.parse(event.data) as LogFrame;
        if (frame.type === "line") {
          const message = frame.message ?? "";
          const dedupeKey = frame.timestamp ? `${frame.timestamp}\u0000${message}` : "";
          if (dedupeKey && seenLogFramesRef.current.has(dedupeKey)) return;
          if (dedupeKey) seenLogFramesRef.current.add(dedupeKey);
          if (frame.timestamp && (!latestTimestampRef.current || frame.timestamp > latestTimestampRef.current)) {
            latestTimestampRef.current = frame.timestamp;
          }
          setLines((current) => [...current, message]);
        } else if (frame.type === "error") {
          setError(frame.message ?? "Log stream failed");
          setStatus("error");
        } else if (frame.type === "end") {
          setStatus("complete");
        }
      };
      ws.onerror = () => {
        if (!closed) setStatus("error");
      };
      ws.onclose = () => {
        if (closed || !follow) return;
        setStatus("reconnecting");
        retryTimer = window.setTimeout(connect, 1500);
      };
      return ws;
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [clusterId, container, decodedName, decodedNamespace, follow, restartKey, tailLines]);

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
    const parts = [decodedNamespace, decodedName, container, stamp].filter(Boolean);
    link.download = `${parts.join("-")}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <Link to={`/clusters/${clusterId}/pods`} className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Pods
          </Link>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{decodedName}</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{decodedNamespace}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setRestartKey((value) => value + 1)}>
            <RefreshCcw className={cn("h-4 w-4", status === "connecting" && "animate-spin")} />
            Reconnect
          </Button>
          <Button variant="secondary" onClick={downloadLogs} disabled={lines.length === 0}>
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}

      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium uppercase text-muted-foreground">Container</span>
          <select
            value={container}
            onChange={(event) => setContainer(event.target.value)}
            className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm"
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
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
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
    </div>
  );
}
