import type { DisplayColor } from "../../lib/api";

const COLOR_CLASSES: Record<DisplayColor, string> = {
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  cyan: "bg-cyan-500",
  fuchsia: "bg-fuchsia-500",
  indigo: "bg-indigo-500"
};

export function clusterChipColorClass(color: string) {
  return COLOR_CLASSES[color as DisplayColor] ?? COLOR_CLASSES.blue;
}
