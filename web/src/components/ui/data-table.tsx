import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Search, SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { cn } from "../../lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => ReactNode;
  sortAccessor?: (row: T) => string | number;
  sortable?: boolean;
  hidden?: boolean;
  width?: string;
  align?: "left" | "center" | "right";
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (row: T) => string;
  searchable?: boolean;
  searchPlaceholder?: string;
  selectable?: boolean;
  onRowClick?: (row: T) => void;
  onSelectionChange?: (selected: T[]) => void;
  pageSize?: number;
  emptyMessage?: string;
  loading?: boolean;
  toolbar?: ReactNode;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  searchable = true,
  searchPlaceholder = "Search...",
  selectable = false,
  onRowClick,
  onSelectionChange,
  pageSize = 20,
  emptyMessage = "No results found",
  loading = false,
  toolbar,
  className
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set(columns.filter((column) => !column.hidden).map((column) => column.key)));
  const [showColumnToggle, setShowColumnToggle] = useState(false);

  const activeColumns = useMemo(() => columns.filter((column) => visibleColumns.has(column.key)), [columns, visibleColumns]);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const query = search.toLowerCase();
    return data.filter((row) =>
      activeColumns.some((column) => {
        const value = column.accessor(row);
        return String(value ?? "").toLowerCase().includes(query);
      })
    );
  }, [activeColumns, data, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const column = columns.find((item) => item.key === sortKey);
    if (!column) return filtered;
    const accessor =
      column.sortAccessor ??
      ((row: T) => {
        const value = column.accessor(row);
        return String(value ?? "");
      });
    return [...filtered].sort((a, b) => {
      const aValue = accessor(a);
      const bValue = accessor(b);
      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDir === "asc" ? aValue - bValue : bValue - aValue;
      }
      return sortDir === "asc" ? String(aValue).localeCompare(String(bValue)) : String(bValue).localeCompare(String(aValue));
    });
  }, [columns, filtered, sortDir, sortKey]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const paginated = useMemo(() => sorted.slice(page * pageSize, (page + 1) * pageSize), [page, pageSize, sorted]);

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  const toggleSelection = useCallback(
    (key: string) => {
      setSelectedKeys((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        onSelectionChange?.(data.filter((row) => next.has(keyExtractor(row))));
        return next;
      });
    },
    [data, keyExtractor, onSelectionChange]
  );

  const toggleAllSelection = useCallback(() => {
    setSelectedKeys((previous) => {
      if (previous.size === paginated.length) {
        onSelectionChange?.([]);
        return new Set();
      }
      const keys = paginated.map(keyExtractor);
      onSelectionChange?.(paginated);
      return new Set(keys);
    });
  }, [keyExtractor, onSelectionChange, paginated]);

  const toggleColumn = useCallback((key: string) => {
    setVisibleColumns((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          {searchable ? (
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {search ? (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}
          {toolbar}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowColumnToggle((current) => !current)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Columns
          </button>

          {showColumnToggle ? (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-lg">
              {columns.map((column) => (
                <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(column.key)}
                    onChange={() => toggleColumn(column.key)}
                    className="rounded border-border text-primary focus:ring-ring"
                  />
                  {column.header}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {selectable ? (
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedKeys.size === paginated.length && paginated.length > 0}
                      onChange={toggleAllSelection}
                      className="rounded border-border text-primary focus:ring-ring"
                    />
                  </th>
                ) : null}
                {activeColumns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      "whitespace-nowrap px-4 py-3 font-medium text-muted-foreground",
                      column.align === "center" && "text-center",
                      column.align === "right" && "text-right",
                      column.sortable !== false && "cursor-pointer select-none hover:text-foreground"
                    )}
                    style={column.width ? { width: column.width } : undefined}
                    onClick={() => column.sortable !== false && handleSort(column.key)}
                  >
                    <div
                      className={cn(
                        "flex items-center gap-1",
                        column.align === "center" && "justify-center",
                        column.align === "right" && "justify-end"
                      )}
                    >
                      {column.header}
                      {column.sortable !== false ? (
                        <span className="text-muted-foreground/50">
                          {sortKey === column.key ? (
                            sortDir === "asc" ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3 w-3" />
                          )}
                        </span>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <tr key={index} className="border-b border-border last:border-0">
                    {selectable ? (
                      <td className="px-3 py-3">
                        <div className="h-4 w-4 animate-pulse rounded bg-muted" />
                      </td>
                    ) : null}
                    {activeColumns.map((column) => (
                      <td key={column.key} className="px-4 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-muted-foreground">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                paginated.map((row) => {
                  const key = keyExtractor(row);
                  return (
                    <tr
                      key={key}
                      className={cn(
                        "border-b border-border transition-colors last:border-0",
                        onRowClick && "cursor-pointer hover:bg-muted/50",
                        selectedKeys.has(key) && "bg-muted/30"
                      )}
                      onClick={() => onRowClick?.(row)}
                    >
                      {selectable ? (
                        <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                          <input checked={selectedKeys.has(key)} onChange={() => toggleSelection(key)} type="checkbox" className="rounded border-border text-primary focus:ring-ring" />
                        </td>
                      ) : null}
                      {activeColumns.map((column) => (
                        <td key={column.key} className={cn("px-4 py-3", column.align === "center" && "text-center", column.align === "right" && "text-right")}>
                          {column.accessor(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, index) => {
              const pageNumber = totalPages <= 5 ? index : Math.max(0, Math.min(page - 2, totalPages - 5)) + index;
              return (
                <button
                  key={pageNumber}
                  onClick={() => setPage(pageNumber)}
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors",
                    pageNumber === page ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {pageNumber + 1}
                </button>
              );
            })}
            <button
              onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              disabled={page === totalPages - 1}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
