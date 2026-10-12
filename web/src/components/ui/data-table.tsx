import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTablePreferences } from "../../hooks/use-table-preferences";
import { tableKeyboardNavigation } from "../../lib/table-preferences";
import { cn } from "../../lib/utils";
import { SearchInput } from "./search-input";
import { TablePagination } from "./table-pagination";
import { TableTools } from "./table-preferences";

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => ReactNode;
  textAccessor?: (row: T) => string | number;
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
  className,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const table = useTablePreferences(
    `shared:${window.location.pathname}:${columns.map((c) => c.key).join(",")}`,
    columns.map((c) => ({
      key: c.key,
      label: c.header,
      hidden: c.hidden,
      width:
        c.width && /^\d+px$/.test(c.width)
          ? Number.parseInt(c.width)
          : undefined,
    })),
  );
  const activeColumns = useMemo(
    () => columns.filter((column) => !table.value.hidden.includes(column.key)),
    [columns, table.value.hidden],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const query = search.toLowerCase();
    return data.filter((row) =>
      activeColumns.some((column) => {
        const value = (
          column.textAccessor ??
          column.sortAccessor ??
          column.accessor
        )(row);
        return String(value ?? "")
          .toLowerCase()
          .includes(query);
      }),
    );
  }, [activeColumns, data, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const column = columns.find((item) => item.key === sortKey);
    if (!column) return filtered;
    const accessor =
      column.sortAccessor ??
      column.textAccessor ??
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
      return sortDir === "asc"
        ? String(aValue).localeCompare(String(bValue))
        : String(bValue).localeCompare(String(aValue));
    });
  }, [columns, filtered, sortDir, sortKey]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  if (safePage !== page) setPage(safePage);
  const paginated = useMemo(
    () => sorted.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [safePage, pageSize, sorted],
  );

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
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
    [data, keyExtractor, onSelectionChange],
  );

  const toggleAllSelection = useCallback(() => {
    setSelectedKeys((previous) => {
      if (paginated.every((row) => previous.has(keyExtractor(row)))) {
        onSelectionChange?.([]);
        return new Set();
      }
      const keys = paginated.map(keyExtractor);
      onSelectionChange?.(paginated);
      return new Set(keys);
    });
  }, [keyExtractor, onSelectionChange, paginated]);

  return (
    <div
      onKeyDown={tableKeyboardNavigation}
      className={cn("space-y-3", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          {searchable ? (
            <SearchInput
              className="max-w-sm flex-1"
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
            />
          ) : null}
          {toolbar}
        </div>

        <TableTools
          table={table}
          rows={sorted.map((row) =>
            Object.fromEntries(
              columns.map((column) => {
                const value = (
                  column.textAccessor ??
                  column.sortAccessor ??
                  column.accessor
                )(row);
                return [
                  column.key,
                  typeof value === "string" || typeof value === "number"
                    ? value
                    : "",
                ];
              }),
            ),
          )}
          filename="table"
          current={{
            query: search,
            sortKey: sortKey ?? columns[0]?.key ?? "",
            sortDirection: sortDir,
          }}
          onView={(view) => {
            setSearch(view.query);
            setSortKey(view.sortKey);
            setSortDir(view.sortDirection);
            setPage(0);
          }}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="k8s-table">
            <thead className="k8s-thead">
              <tr className="border-b border-border bg-muted/50">
                {selectable ? (
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={
                        paginated.length > 0 &&
                        paginated.every((row) =>
                          selectedKeys.has(keyExtractor(row)),
                        )
                      }
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
                      column.sortable !== false &&
                        "cursor-pointer select-none hover:text-foreground",
                    )}
                    style={table.style(column.key, true)}
                    tabIndex={column.sortable !== false ? 0 : undefined}
                    aria-sort={
                      sortKey === column.key
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    onKeyDown={(e) => {
                      if (
                        e.target === e.currentTarget &&
                        (e.key === "Enter" || e.key === " ") &&
                        column.sortable !== false
                      ) {
                        e.preventDefault();
                        handleSort(column.key);
                      }
                    }}
                    onClick={() =>
                      column.sortable !== false && handleSort(column.key)
                    }
                  >
                    <div
                      className={cn(
                        "flex items-center gap-1",
                        column.align === "center" && "justify-center",
                        column.align === "right" && "justify-end",
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
                  <tr
                    key={index}
                    className="border-b border-border last:border-0"
                  >
                    {selectable ? (
                      <td className="px-3 py-3">
                        <div className="h-4 w-4 animate-pulse rounded bg-muted" />
                      </td>
                    ) : null}
                    {activeColumns.map((column) => (
                      <td
                        key={column.key}
                        style={table.style(column.key)}
                        className="px-4 py-3"
                      >
                        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginated.length === 0 ? (
                <tr>
                  <td
                    colSpan={activeColumns.length + (selectable ? 1 : 0)}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                paginated.map((row) => {
                  const key = keyExtractor(row);
                  return (
                    <tr
                      key={key}
                      tabIndex={onRowClick ? 0 : undefined}
                      className={cn(
                        "border-b border-border transition-colors last:border-0",
                        onRowClick && "cursor-pointer hover:bg-muted/50",
                        selectedKeys.has(key) && "bg-muted/30",
                      )}
                      onClick={() => onRowClick?.(row)}
                    >
                      {selectable ? (
                        <td
                          className="px-3 py-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            checked={selectedKeys.has(key)}
                            onChange={() => toggleSelection(key)}
                            type="checkbox"
                            className="rounded border-border text-primary focus:ring-ring"
                          />
                        </td>
                      ) : null}
                      {activeColumns.map((column) => (
                        <td
                          key={column.key}
                          style={table.style(column.key)}
                          className={cn(
                            "px-4 py-3",
                            column.align === "center" && "text-center",
                            column.align === "right" && "text-right",
                          )}
                        >
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
        <TablePagination
          total={sorted.length}
          page={safePage + 1}
          pageSize={pageSize}
          onPageChange={(next) => setPage(next - 1)}
        />
      ) : null}
    </div>
  );
}
