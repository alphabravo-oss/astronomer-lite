import type { Cluster, DisplayColor } from "../../lib/api";
import { cn } from "../../lib/utils";
import { clusterChipColorClass } from "./cluster-chip-colors";

const SIZE_CLASSES = {
  sm: "h-5 w-5 text-[10px]",
  md: "h-6 w-6 text-[11px]",
  lg: "h-7 w-7 text-xs"
} as const;

export type ChipSize = keyof typeof SIZE_CLASSES;

export function ClusterChip({
  cluster,
  size = "md",
  className,
  title
}: {
  cluster: Pick<Cluster, "displayColor" | "displayInitials" | "name">;
  size?: ChipSize;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-semibold tracking-tight text-white",
        clusterChipColorClass(cluster.displayColor as DisplayColor),
        SIZE_CLASSES[size],
        className
      )}
      title={title ?? cluster.name}
      aria-hidden
    >
      {cluster.displayInitials || "?"}
    </span>
  );
}
