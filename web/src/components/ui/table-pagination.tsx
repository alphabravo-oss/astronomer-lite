import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { Select } from "./input";
import { cn } from "../../lib/utils";

type TablePaginationProps = {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (size: number) => void;
  className?: string;
};
// Pages are one-based in the UI; callers with zero-based state adapt at the boundary.
export function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  className,
}: TablePaginationProps) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), count);
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <span>
        {total === 0 ? 0 : (current - 1) * pageSize + 1}-
        {Math.min(current * pageSize, total)} of {total}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {pageSizeOptions && onPageSizeChange && (
          <label className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-8 w-auto px-2"
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onPageChange(current - 1)}
          disabled={current === 1}
          aria-label="Previous page"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </Button>
        <span className="min-w-16 text-center" aria-live="polite">
          {current} / {count}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onPageChange(current + 1)}
          disabled={current === count}
          aria-label="Next page"
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
