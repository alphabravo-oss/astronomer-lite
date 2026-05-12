import { createContext, useContext } from "react";

export type ActivityKind = "logs" | "exec" | "attach" | "yaml" | "port-forward";

export type Activity = {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  href: string;
};

export type ActivityContextValue = {
  activities: Activity[];
  pin: (activity: Activity) => void;
  unpin: (id: string) => void;
  hasActivity: (id: string) => boolean;
};

export const ActivityContext = createContext<ActivityContextValue | null>(null);

export function useActivities() {
  const value = useContext(ActivityContext);
  if (!value) throw new Error("useActivities must be used inside <ActivityProvider>");
  return value;
}
