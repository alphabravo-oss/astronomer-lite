import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "default" | "success" | "warning" | "danger" | "muted";
};

export function Badge({ className, tone = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium",
        tone === "default" && "border-accent/35 bg-accent/10 text-accent",
        tone === "success" && "border-status-success/35 bg-status-success/10 text-status-success",
        tone === "warning" && "border-status-warning/35 bg-status-warning/10 text-status-warning",
        tone === "danger" && "border-destructive/35 bg-destructive/10 text-destructive",
        tone === "muted" && "border-border bg-muted text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
