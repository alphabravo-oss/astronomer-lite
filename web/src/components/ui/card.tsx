import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/** Shared surface and density-aware padding for forms, summaries and metrics. */
export function Card({
  as: Element = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section" }) {
  return (
    <Element
      className={cn(
        "min-w-0 rounded-lg border border-border bg-card p-[var(--card-p)]",
        className,
      )}
      {...props}
    />
  );
}
