import { createContext, useContext } from "react";

export type ActivityKind = "logs" | "exec" | "attach" | "yaml" | "port-forward";

export type LogActivityStream = {
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  tailLines: number;
};

export type Activity = {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  href: string;
  // Present when kind === "logs" and we own a persistent stream behind the
  // dock entry. Lets pages discover and re-attach to the running stream.
  logStream?: LogActivityStream;
};

export type ActivityContextValue = {
  activities: Activity[];
  pin: (activity: Activity) => void;
  unpin: (id: string) => void;
  hasActivity: (id: string) => boolean;
  getActivity: (id: string) => Activity | undefined;
};

export const ActivityContext = createContext<ActivityContextValue | null>(null);

export function useActivities() {
  const value = useContext(ActivityContext);
  if (!value) throw new Error("useActivities must be used inside <ActivityProvider>");
  return value;
}

export function logActivityId(stream: { clusterId: string; namespace: string; pod: string }): string {
  return `logs:${stream.clusterId}:${stream.namespace}:${stream.pod}`;
}
