import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/utils";

export type ActionMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
  separator?: boolean;
};

type ActionMenuProps = {
  items: ActionMenuItem[];
  label?: string;
};

const menuWidth = 176;
const menuGap = 4;
const menuMinHeight = 120;

export function ActionMenu({ items, label = "Open actions" }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; flipped: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleClose() {
      setOpen(false);
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("resize", handleClose);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < menuMinHeight;
    const top = flipUp ? rect.top - menuGap : rect.bottom + menuGap;
    let left = rect.right - menuWidth;

    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;

    setCoords({ top, left, flipped: flipUp });
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                width: menuWidth,
                transform: coords.flipped ? "translateY(-100%)" : undefined
              }}
              className="z-[9999] rounded-md border border-border bg-popover p-1 shadow-lg"
              onClick={(event) => event.stopPropagation()}
            >
              {items.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  {item.separator && index > 0 ? <div className="my-1 h-px bg-border" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      if (item.disabled) return;
                      item.onClick();
                      setOpen(false);
                    }}
                    disabled={item.disabled}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors",
                      item.disabled && "cursor-not-allowed opacity-50",
                      item.variant === "destructive"
                        ? "text-status-error hover:bg-status-error/10"
                        : "text-popover-foreground hover:bg-accent"
                    )}
                  >
                    {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
                    <span className="truncate">{item.label}</span>
                  </button>
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
