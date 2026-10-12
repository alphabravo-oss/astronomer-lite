import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/** One control per group keeps the collapsed rail short and readable. */
export function SidebarRailGroup({
  label,
  icon: Icon,
  active = false,
  children,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnMobile = () => {
      if (!desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnMobile);
    return () => desktop.removeEventListener("change", closeOnMobile);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "nav-item h-9 w-full justify-center px-0",
            active && "active",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          // Radix skips links during default autofocus; navigation starts on the first link.
          event.preventDefault();
          contentRef.current
            ?.querySelector<HTMLAnchorElement>("a[href]")
            ?.focus();
        }}
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        aria-label={`${label} navigation`}
        className="max-h-[min(70vh,var(--radix-popover-content-available-height))] w-64 overflow-y-auto p-1"
      >
        <p className="px-3 py-1.5 text-2xs font-semibold uppercase text-muted-foreground">
          {label}
        </p>
        <nav aria-label={label} className="space-y-0.5">
          {children(() => setOpen(false))}
        </nav>
      </PopoverContent>
    </Popover>
  );
}

/** Supplemental links keep the same content in expanded and collapsed navigation. */
export function SidebarLinkGroup({
  collapsed,
  onNavigate,
  children,
  ...group
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  children: (onNavigate?: () => void) => ReactNode;
}) {
  if (collapsed)
    return <SidebarRailGroup {...group}>{children}</SidebarRailGroup>;
  return (
    <div className="mb-1 mt-2">
      <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
        {group.label}
      </p>
      <div className="space-y-1">{children(onNavigate)}</div>
    </div>
  );
}
