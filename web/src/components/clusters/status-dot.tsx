import { cn } from "../../lib/utils";

export function StatusDot({ reachable, degraded }: { reachable: boolean; degraded?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        reachable && !degraded && "bg-status-success",
        reachable && degraded && "bg-status-warning",
        !reachable && "bg-destructive"
      )}
    />
  );
}
