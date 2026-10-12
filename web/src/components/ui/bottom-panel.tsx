import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, X } from "lucide-react";
import { Tabs } from "./tabs";

export type BottomPanelTab = {
  key: string;
  label: string;
  icon?: ReactNode;
};

type BottomPanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  tabs?: BottomPanelTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  children: ReactNode;
};

export function BottomPanel({
  open,
  onClose,
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  children,
}: BottomPanelProps) {
  const [height, setHeight] = useState(40);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(40);

  useEffect(() => {
    setPortalTarget(document.getElementById("bottom-panel-root"));
  }, []);

  const onDragStart = useCallback(
    (event: MouseEvent) => {
      dragging.current = true;
      startY.current = event.clientY;
      startHeight.current = height;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  useEffect(() => {
    function onMouseMove(event: globalThis.MouseEvent) {
      if (!dragging.current) return;
      const delta = startY.current - event.clientY;
      const nextHeight =
        startHeight.current + (delta / window.innerHeight) * 100;
      setHeight(Math.max(20, Math.min(80, nextHeight)));
    }

    function onMouseUp() {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleKey(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"]')
      )
        onClose();
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, open]);

  if (!portalTarget) return null;

  return createPortal(
    <section
      className="flex shrink-0 flex-col overflow-hidden border-t border-border bg-card shadow-[0_-12px_32px_rgba(0,0,0,0.18)]"
      style={{ height: open ? `${height}vh` : "0px" }}
    >
      {open ? (
        <>
          <div
            role="separator"
            aria-label="Resize details panel"
            aria-orientation="horizontal"
            aria-valuenow={height}
            aria-valuemin={20}
            aria-valuemax={80}
            tabIndex={0}
            onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              setHeight((current) =>
                event.key === "Home"
                  ? 20
                  : event.key === "End"
                    ? 80
                    : Math.max(
                        20,
                        Math.min(
                          80,
                          current + (event.key === "ArrowUp" ? 5 : -5),
                        ),
                      ),
              );
            }}
            onMouseDown={onDragStart}
            className="flex h-2 shrink-0 cursor-row-resize items-center justify-center transition-colors hover:bg-accent/50"
          >
            <GripHorizontal className="h-3 w-3 text-muted-foreground" />
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
            <div className="flex min-w-0 items-center gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-medium">{title}</h2>
                {subtitle ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close bottom panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {tabs && tabs.length > 1 && activeTab && onTabChange ? (
            <Tabs
              label={`${title} views`}
              tabs={tabs.map((tab) => ({
                value: tab.key,
                label: (
                  <>
                    {tab.icon}
                    {tab.label}
                  </>
                ),
              }))}
              value={activeTab}
              onChange={onTabChange}
              className="flex min-h-0 flex-1 flex-col space-y-0"
              panelClassName="min-h-0 flex-1 overflow-auto"
            >
              {children}
            </Tabs>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          )}
        </>
      ) : null}
    </section>,
    portalTarget,
  );
}
