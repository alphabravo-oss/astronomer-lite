import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityContext, type Activity, type ActivityContextValue } from "./activities-context";

// Activity dock: pin long-running views (logs / exec / yaml-edit) so the user
// can navigate elsewhere and return without losing context. The current
// implementation persists the *URL* of the activity and re-mounts it on
// restore — the underlying WebSocket reconnects when the page mounts again.
// True persistent-stream support is a follow-up.

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

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Activity[]>(() => readStored());

  useEffect(() => {
    writeStored(activities);
  }, [activities]);

  const pin = useCallback((activity: Activity) => {
    setActivities((current) => {
      if (current.some((a) => a.id === activity.id)) return current;
      return [...current, activity].slice(-8);
    });
  }, []);

  const unpin = useCallback((id: string) => {
    setActivities((current) => current.filter((a) => a.id !== id));
  }, []);

  const hasActivity = useCallback((id: string) => activities.some((a) => a.id === id), [activities]);

  const value = useMemo<ActivityContextValue>(
    () => ({ activities, pin, unpin, hasActivity }),
    [activities, hasActivity, pin, unpin]
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}
