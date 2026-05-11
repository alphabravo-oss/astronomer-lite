import { useEffect, useMemo, useRef, useState } from "react";
import type { GVRDescriptor, WatchFrame } from "../lib/api";
import { api } from "../lib/api";

export type WatchStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

type UseWatchOptions = {
  clusterId: string;
  gvr: GVRDescriptor | null;
  namespaces?: string[];
  enabled?: boolean;
  onFrame: (frame: WatchFrame) => void;
  onReset?: () => void;
  onError?: (message: string) => void;
  errorMessage?: string;
};

export function useWatch({ clusterId, gvr, namespaces = [], enabled = true, onFrame, onReset, onError, errorMessage = "Resource watch failed" }: UseWatchOptions) {
  const [status, setStatus] = useState<WatchStatus>("idle");
  const onFrameRef = useRef(onFrame);
  const onResetRef = useRef(onReset);
  const onErrorRef = useRef(onError);
  const errorMessageRef = useRef(errorMessage);
  const namespaceKey = namespaces.join("\0");
  const hasGVR = Boolean(gvr);
  const gvrGroup = gvr?.group ?? "";
  const gvrVersion = gvr?.version ?? "";
  const gvrResource = gvr?.resource ?? "";
  const gvrKind = gvr?.kind ?? "";
  const gvrNamespaced = gvr?.namespaced ?? false;
  const watchDescriptor = useMemo(
    () => (hasGVR ? { group: gvrGroup, version: gvrVersion, resource: gvrResource, kind: gvrKind, namespaced: gvrNamespaced } : null),
    [gvrGroup, gvrKind, gvrNamespaced, gvrResource, gvrVersion, hasGVR]
  );

  useEffect(() => {
    onFrameRef.current = onFrame;
    onResetRef.current = onReset;
    onErrorRef.current = onError;
    errorMessageRef.current = errorMessage;
  }, [errorMessage, onError, onFrame, onReset]);

  useEffect(() => {
    if (!enabled || !clusterId || !watchDescriptor) {
      setStatus("idle");
      return;
    }
    let closed = false;
    let retryTimer: number | undefined;
    let socket: WebSocket | null = null;
    const watchNamespaces = namespaceKey ? namespaceKey.split("\0") : [];

    const connect = () => {
      setStatus((current) => (current === "connected" ? "connected" : "connecting"));
      socket = new WebSocket(api.watchUrl(clusterId, watchDescriptor, watchNamespaces));
      socket.onopen = () => {
        if (!closed) setStatus("connected");
      };
      socket.onmessage = (event) => {
        const frame = JSON.parse(event.data) as WatchFrame;
        if (frame.type === "RESET") {
          onResetRef.current?.();
          return;
        }
        if (frame.type === "ERROR") {
          setStatus("error");
          onErrorRef.current?.(frame.message ?? errorMessageRef.current);
          return;
        }
        onFrameRef.current(frame);
      };
      socket.onclose = () => {
        if (closed) return;
        setStatus("reconnecting");
        retryTimer = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => {
        if (!closed) setStatus("error");
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [clusterId, enabled, namespaceKey, watchDescriptor]);

  return status;
}
