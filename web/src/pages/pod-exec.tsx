import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ArrowLeft, PlugZap, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import type { ExecFrame, PodDetail } from "../lib/api";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

const defaultCommand = "/bin/sh";
const stdinEncoder = new TextEncoder();

export function PodExecPage() {
  const { clusterId = "", namespace = "", name = "" } = useParams();
  const location = useLocation();
  const decodedNamespace = decodeURIComponent(namespace);
  const decodedName = decodeURIComponent(name);
  const attachMode = location.pathname.endsWith("/attach");
  const modeLabel = attachMode ? "Attach" : "Exec";
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [detail, setDetail] = useState<PodDetail | null>(null);
  const [container, setContainer] = useState("");
  const [command, setCommand] = useState(defaultCommand);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "closed" | "error">("idle");
  const [error, setError] = useState("");
  const [sessionKey, setSessionKey] = useState(0);

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

  const connect = useCallback(() => {
    const root = terminalRef.current;
    if (!root || !clusterId || !decodedNamespace || !decodedName) return;
    socketRef.current?.close();
    terminalInstanceRef.current?.dispose();
    root.innerHTML = "";
    setError("");
    setStatus("connecting");

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "var(--font-mono), JetBrains Mono, monospace",
      fontSize: 13,
      theme: {
        background: "#0a0a0f",
        foreground: "#d4d4d8",
        cursor: "#fafafa",
        selectionBackground: "#3f3f46"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(root);
    fitAddon.fit();
    terminal.writeln(`Connecting to ${decodedNamespace}/${decodedName}...`);
    if (attachMode) {
      terminal.writeln("Attaching to the running container process...");
    } else {
      terminal.writeln(`Command: ${command}`);
    }
    terminal.writeln("");

    const socket = new WebSocket(
      attachMode
        ? api.podAttachUrl(clusterId, decodedNamespace, decodedName, container)
        : api.podExecUrl(clusterId, decodedNamespace, decodedName, container, commandParts(command))
    );
    socketRef.current = socket;
    terminalInstanceRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const sendResize = () => {
      fitAddon.fit();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      }
    };
    const disposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(stdinEncoder.encode(data));
    });
    socket.onopen = () => {
      setStatus("connected");
      sendResize();
      terminal.focus();
    };
    socket.onmessage = (event) => {
      const frame = JSON.parse(event.data) as ExecFrame;
      if (frame.type === "stdout" || frame.type === "stderr") {
        terminal.write(frame.message ?? "");
      } else if (frame.type === "error") {
        setError(frame.message ?? `${modeLabel} session failed`);
        terminal.writeln(`\r\n${frame.message ?? `${modeLabel} session failed`}`);
        setStatus("error");
      } else if (frame.type === "end") {
        terminal.writeln("\r\nSession ended.");
        setStatus("closed");
      }
    };
    socket.onerror = () => {
      setStatus("error");
    };
    socket.onclose = () => {
      setStatus((current) => (current === "error" ? "error" : "closed"));
    };

    const resize = () => sendResize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      disposable.dispose();
      socket.close();
      terminal.dispose();
    };
  }, [attachMode, clusterId, command, container, decodedName, decodedNamespace, modeLabel]);

  useEffect(() => {
    if (!container) return;
    return connect();
  }, [connect, container, sessionKey]);

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
        <Button variant="secondary" onClick={() => setSessionKey((value) => value + 1)}>
          <RefreshCcw className={cn("h-4 w-4", status === "connecting" && "animate-spin")} />
          Reconnect
        </Button>
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
        {!attachMode ? (
          <label className="min-w-56 flex-1 space-y-1 text-sm">
            <span className="text-xs font-medium uppercase text-muted-foreground">Command</span>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        ) : null}
        <Button variant="secondary" onClick={() => setSessionKey((value) => value + 1)}>
          <PlugZap className="h-4 w-4" />
          {attachMode ? "Attach" : "Connect"}
        </Button>
        <div className="ml-auto text-xs uppercase text-muted-foreground">{status}</div>
      </section>

      <div ref={terminalRef} className="h-[calc(100vh-20rem)] min-h-96 overflow-hidden rounded-lg border border-border bg-[#0a0a0f] p-2" />
    </div>
  );
}

function commandParts(command: string) {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) current += "\\";
  if (current) parts.push(current);
  return parts.length > 0 ? parts : [defaultCommand];
}
