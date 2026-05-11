import { cn } from "../../lib/utils";

type StatusBadgeProps = {
  status: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  className?: string;
};

const healthyStatuses = new Set(["active", "healthy", "running", "synced", "connected", "reachable", "ready"]);

export function StatusBadge({ status, label, size = "md", pulse, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  const displayLabel = label ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/([A-Z])/g, " $1");
  const shouldPulse = pulse ?? healthyStatuses.has(normalized);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
        size === "sm" && "px-2 py-0.5 text-[10px] leading-4",
        size === "md" && "px-2.5 py-0.5 text-xs leading-5",
        size === "lg" && "px-3 py-1 text-sm leading-5",
        statusBgColor(normalized),
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {shouldPulse ? (
          <span className={cn("absolute inline-flex h-full w-full animate-pulse-dot rounded-full opacity-75", statusDotColor(normalized))} />
        ) : null}
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", statusDotColor(normalized))} />
      </span>
      {displayLabel}
    </span>
  );
}

function statusBgColor(status: string) {
  if (["active", "healthy", "running", "synced", "connected", "reachable", "ready", "true"].includes(status)) {
    return "bg-status-success/10 text-status-success";
  }
  if (["pending", "progressing", "warning", "degraded", "unknown"].includes(status)) {
    return "bg-status-warning/10 text-status-warning";
  }
  if (["error", "failed", "unhealthy", "unreachable", "crashloopbackoff", "false"].includes(status)) {
    return "bg-status-error/10 text-status-error";
  }
  return "bg-muted text-muted-foreground";
}

function statusDotColor(status: string) {
  if (["active", "healthy", "running", "synced", "connected", "reachable", "ready", "true"].includes(status)) {
    return "bg-status-success";
  }
  if (["pending", "progressing", "warning", "degraded", "unknown"].includes(status)) {
    return "bg-status-warning";
  }
  if (["error", "failed", "unhealthy", "unreachable", "crashloopbackoff", "false"].includes(status)) {
    return "bg-status-error";
  }
  return "bg-status-neutral";
}
