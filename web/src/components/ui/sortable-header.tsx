import { ArrowDownUp } from "lucide-react";
import { cn } from "../../lib/utils";

export type SortDirection = "asc" | "desc";

type SortableHeaderProps<K extends string> = {
  label: string;
  sortKey: K;
  active: K;
  direction: SortDirection;
  onSort: (key: K) => void;
  className?: string;
};

export function SortableHeader<K extends string>({ label, sortKey, active, direction, onSort, className }: SortableHeaderProps<K>) {
  return (
    <th className={cn("k8s-th", className)}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(sortKey)}>
        {label}
        <ArrowDownUp className={cn("h-3 w-3", active === sortKey && direction === "desc" && "rotate-180")} />
      </button>
    </th>
  );
}
