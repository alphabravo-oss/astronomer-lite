import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityContext, type Activity, type ActivityContextValue } from "./activities-context";
import { hasLogStream, startLogStream, stopLogStream } from "./log-streams";

// Activity dock: pin long-running views (logs / exec / yaml-edit) so the user
// can navigate elsewhere and return without losing context. For logs we keep
// the underlying WebSocket open while the dock entry is pinned, so the page
// can re-attach to a live buffer instead of reconnecting.

const STORAGE_KEY = "astronomer-lite-activities";

function readStored(): Activity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Activity[]) : [];
  } catch {
    return [];
  }
}

function writeStored(activities: Activity[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(activities));
  } catch {
    // Storage blocked — silently skip.
  }
}

function ensureLogStream(activity: Activity) {
  if (activity.kind !== "logs" || !activity.logStream) return;
  if (hasLogStream(activity.logStream)) return;
  startLogStream({
    clusterId: activity.logStream.clusterId,
    namespace: activity.logStream.namespace,
    pod: activity.logStream.pod,
    container: activity.logStream.container,
    tailLines: activity.logStream.tailLines,
    follow: true
  });
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Activity[]>(() => readStored());
  const rehydratedRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    writeStored(activities);
  }, [activities]);

  // On first mount, restart streams for any logs activities that survived a
  // page reload via sessionStorage.
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    for (const activity of activities) {
      ensureLogStream(activity);
    }
    // Intentionally only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pin = useCallback((activity: Activity) => {
    setActivities((current) => {
      if (current.some((a) => a.id === activity.id)) return current;
      return [...current, activity].slice(-8);
    });
    ensureLogStream(activity);
  }, []);

  const unpin = useCallback((id: string) => {
    setActivities((current) => {
      const removed = current.find((a) => a.id === id);
      if (removed?.kind === "logs" && removed.logStream) {
        stopLogStream(removed.logStream);
      }
      return current.filter((a) => a.id !== id);
    });
  }, []);

  const hasActivity = useCallback((id: string) => activities.some((a) => a.id === id), [activities]);
  const getActivity = useCallback((id: string) => activities.find((a) => a.id === id), [activities]);

  const value = useMemo<ActivityContextValue>(
    () => ({ activities, pin, unpin, hasActivity, getActivity }),
    [activities, getActivity, hasActivity, pin, unpin]
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}
