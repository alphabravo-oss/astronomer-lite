import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Input, Select } from "./input";
import { useId, useState } from "react";
import { Download, SlidersHorizontal } from "lucide-react";
import type { useTablePreferences } from "../../hooks/use-table-preferences";
import { Button } from "./button";
import { csvText, type TableView } from "../../lib/table-preferences";

export function TableTools({
  table,
  rows,
  filename,
  current,
  onView,
}: {
  table: ReturnType<typeof useTablePreferences>;
  rows: Record<string, string | number>[];
  filename: string;
  current: Pick<TableView, "query" | "sortKey" | "sortDirection">;
  onView: (view: TableView) => void;
}) {
  const viewId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const { value, update, columns } = table;
  function save() {
    const label = name.trim();
    if (!label) return;
    const views = [
      ...value.views.filter((v) => v.name !== label),
      {
        ...current,
        name: label,
        hidden: value.hidden,
        pinned: value.pinned,
        widths: value.widths,
      },
    ].slice(-20);
    update({ ...value, views });
    setName("");
    setMessage(`Saved view ${label}`);
  }
  function download() {
    const visible = columns.filter((c) => !value.hidden.includes(c.key));
    const text = csvText([
      visible.map((c) => c.label),
      ...rows.map((row) => visible.map((c) => row[c.key] ?? "")),
    ]);
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename.replace(/[^a-z0-9_-]/gi, "-")}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={viewId}>
        Saved table view
      </label>
      <Select
        id={viewId}
        aria-label="Saved table view"
        value=""
        onChange={(e) => {
          const view = value.views.find((v) => v.name === e.target.value);
          if (view) {
            update({
              ...value,
              hidden: view.hidden,
              pinned: view.pinned,
              widths: view.widths,
            });
            onView(view);
          }
        }}
        className="w-auto max-w-48"
      >
        <option value="">Saved views</option>
        {value.views.map((v) => (
          <option key={v.name}>{v.name}</option>
        ))}
      </Select>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="secondary">
            <SlidersHorizontal className="h-4 w-4" />
            Table options
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="Table options"
          className="max-h-[var(--radix-popover-content-available-height)] w-[min(26rem,calc(100vw-2rem))] space-y-3 overflow-y-auto p-4"
        >
          <p className="text-sm font-medium">Columns</p>
          {columns.map((c) => (
            <div key={c.key} className="flex items-center gap-2 text-sm">
              <label className="flex min-w-28 items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Show ${c.label}`}
                  checked={!value.hidden.includes(c.key)}
                  disabled={
                    !value.hidden.includes(c.key) &&
                    value.hidden.length >= columns.length - 1
                  }
                  onChange={() =>
                    update({
                      ...value,
                      hidden: value.hidden.includes(c.key)
                        ? value.hidden.filter((k) => k !== c.key)
                        : [...value.hidden, c.key],
                    })
                  }
                />
                {c.label}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`Pin ${c.label}`}
                  checked={value.pinned.includes(c.key)}
                  onChange={() =>
                    update({
                      ...value,
                      pinned: value.pinned.includes(c.key)
                        ? value.pinned.filter((k) => k !== c.key)
                        : [...value.pinned, c.key],
                    })
                  }
                />
                Pin
              </label>
              <input
                type="range"
                min="80"
                max="600"
                step="10"
                aria-label={`${c.label} column width`}
                value={value.widths[c.key] ?? c.width ?? 160}
                onChange={(e) =>
                  update({
                    ...value,
                    widths: {
                      ...value.widths,
                      [c.key]: Number(e.target.value),
                    },
                  })
                }
                className="min-w-0 flex-1"
              />
            </div>
          ))}
          <form
            className="flex gap-2 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Input
              aria-label="View name"
              placeholder="View name"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1"
            />
            <Button variant="secondary" disabled={!name.trim()}>
              Save view
            </Button>
          </form>
          {value.views.map((v) => (
            <div
              key={v.name}
              className="flex items-center justify-between text-sm"
            >
              <span>{v.name}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete view ${v.name}`}
                onClick={() =>
                  update({
                    ...value,
                    views: value.views.filter((view) => view.name !== v.name),
                  })
                }
              >
                Delete
              </Button>
            </div>
          ))}
          {message && (
            <p role="status" className="text-xs text-muted-foreground">
              {message}
            </p>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              update({
                hidden: [],
                pinned: [],
                widths: {},
                views: value.views,
              });
            }}
          >
            Reset columns
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close table options
          </Button>
        </PopoverContent>
      </Popover>
      <Button variant="secondary" onClick={download} disabled={!rows.length}>
        <Download className="h-4 w-4" />
        Export CSV
      </Button>
    </div>
  );
}
