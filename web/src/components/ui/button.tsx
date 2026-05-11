import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export function Button({ className, variant = "default", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "secondary" && "border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
        variant === "ghost" && "border-transparent bg-transparent hover:bg-accent hover:text-accent-foreground",
        variant === "danger" && "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90",
        size === "sm" && "h-8 px-3",
        size === "md" && "h-9 px-4",
        size === "icon" && "h-9 w-9",
        className
      )}
      {...props}
    />
  );
}
