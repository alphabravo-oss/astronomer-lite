import { useMemo, useState } from "react";
import { buildSplitDiff, type DiffRow } from "../../lib/resource-detail";
import { cn } from "../../lib/utils";

type DiffViewMode = "split" | "unified";

export function ResourceDiff({
  rows,
  unchanged,
  validated,
}: {
  rows: DiffRow[];
  unchanged: boolean;
  validated: boolean;
}) {
  const [mode, setMode] = useState<DiffViewMode>("split");
  const splitRows = useMemo(() => buildSplitDiff(rows), [rows]);

  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Dry-run diff</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Run a dry run before applying. The final Apply button is enabled
            only for the validated YAML.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!unchanged ? (
            <div className="flex rounded-md bg-muted p-0.5">
              {(["split", "unified"] as const).map((nextMode) => (
                <button
                  key={nextMode}
                  type="button"
                  aria-pressed={mode === nextMode}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    mode === nextMode
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setMode(nextMode)}
                >
                  {nextMode}
                </button>
              ))}
            </div>
          ) : null}
          {validated ? (
            <span className="rounded-md bg-status-success/10 px-2 py-1 text-xs font-medium text-status-success">
              Validated
            </span>
          ) : null}
        </div>
      </div>
      {unchanged ? (
        <div className="p-4 text-sm text-muted-foreground">
          No YAML changes.
        </div>
      ) : mode === "split" ? (
        <div className="max-h-96 overflow-auto">
          <div className="grid min-w-[44rem] grid-cols-2 border-b border-border bg-muted/50 text-xs font-medium uppercase text-muted-foreground">
            <div className="border-r border-border px-3 py-2">Original</div>
            <div className="px-3 py-2">Edited</div>
          </div>
          <pre className="font-mono text-xs leading-5">
            {splitRows.map((row, index) => (
              <div
                key={`${index}-${row.before}-${row.after}`}
                className="grid min-w-[44rem] grid-cols-2 border-b border-border/40"
              >
                <span
                  className={cn(
                    "min-w-0 whitespace-pre-wrap break-words border-r border-border/60 px-3 py-0.5",
                    row.beforeType === "remove"
                      ? "bg-destructive/10 text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {row.before || " "}
                </span>
                <span
                  className={cn(
                    "min-w-0 whitespace-pre-wrap break-words px-3 py-0.5",
                    row.afterType === "add"
                      ? "bg-status-success/10 text-status-success"
                      : "text-muted-foreground",
                  )}
                >
                  {row.after || " "}
                </span>
              </div>
            ))}
          </pre>
        </div>
      ) : (
        <pre className="max-h-96 overflow-auto p-0 font-mono text-xs leading-5">
          {rows.map((row, index) => (
            <div
              key={`${row.type}-${index}-${row.line}`}
              className={cn(
                "grid grid-cols-[2rem_1fr] gap-3 border-b border-border/40 px-3 py-0.5",
                row.type === "add" &&
                  "bg-status-success/10 text-status-success",
                row.type === "remove" && "bg-destructive/10 text-destructive",
                row.type === "same" && "text-muted-foreground",
              )}
            >
              <span>
                {row.type === "add" ? "+" : row.type === "remove" ? "-" : " "}
              </span>
              <span className="whitespace-pre-wrap break-words">
                {row.line || " "}
              </span>
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}
