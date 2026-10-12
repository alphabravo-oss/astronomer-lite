import { useId, type ReactNode } from "react";
import { cn } from "../../lib/utils";

type Tab<T extends string> = { value: T; label: ReactNode };

/** Local views: automatic activation, roving focus and linked panels. */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  children,
  className,
  panelClassName,
}: {
  label: string;
  tabs: Tab<T>[];
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
}) {
  const id = useId();
  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      <div
        role="tablist"
        aria-label={label}
        className="flex overflow-x-auto border-b border-border"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.value}
            id={`${id}-tab-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={value === tab.value}
            aria-controls={`${id}-panel-${tab.value}`}
            tabIndex={value === tab.value ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => {
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + tabs.length) % tabs.length
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              onChange(tabs[next].value);
              document.getElementById(`${id}-tab-${tabs[next].value}`)?.focus();
            }}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              value === tab.value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.value}
          role="tabpanel"
          hidden={tab.value !== value}
          id={`${id}-panel-${tab.value}`}
          aria-labelledby={`${id}-tab-${tab.value}`}
          tabIndex={0}
          className={cn(
            "min-w-0 space-y-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            panelClassName,
          )}
        >
          {tab.value === value ? children : null}
        </div>
      ))}
    </div>
  );
}
