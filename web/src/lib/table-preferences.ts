import type { KeyboardEvent } from "react";
export type TableView = { name: string; query: string; sortKey: string; sortDirection: "asc" | "desc"; hidden: string[]; pinned: string[]; widths: Record<string, number> };
export type TablePreferences = Pick<TableView, "hidden" | "pinned" | "widths"> & { views: TableView[] };
export function csvText(rows: (string | number)[][]) {
  return rows.map((row) => row.map((cell) => {
    let value = String(cell).replace(/\r\n/g, "\n");
    // Spreadsheet formula injection also applies to Kubernetes names/labels.
    // eslint-disable-next-line no-control-regex -- Deliberately reject control-prefixed formulas.
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)) value = "'" + value;
    return `"${value.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
}
export function readTablePreferences(key: string, columns: { key: string; hidden?: boolean }[]): TablePreferences {
  const empty: TablePreferences = { hidden: columns.filter((c) => c.hidden).map((c) => c.key).slice(0, Math.max(0, columns.length - 1)), pinned: [], widths: {}, views: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    if (!raw || typeof raw !== "object") return empty;
    const keys = new Set(columns.map((c) => c.key));
    const clean = (v: Record<string, unknown>) => ({
      hidden: Array.isArray(v.hidden) ? [...new Set(v.hidden.filter((k): k is string => typeof k === "string" && keys.has(k)))].slice(0, Math.max(0, columns.length - 1)) : [],
      pinned: Array.isArray(v.pinned) ? [...new Set(v.pinned.filter((k): k is string => typeof k === "string" && keys.has(k)))] : [],
      widths: Object.fromEntries(Object.entries(v.widths && typeof v.widths === "object" ? v.widths : {}).filter(([k, width]) => keys.has(k) && typeof width === "number" && Number.isFinite(width) && width >= 80 && width <= 600)) as Record<string, number>
    });
    return { ...clean(raw), views: (Array.isArray(raw.views) ? raw.views : []).filter((v: TableView) => v && typeof v.name === "string" && v.name.length <= 60 && typeof v.query === "string" && v.query.length <= 1000 && keys.has(v.sortKey) && ["asc", "desc"].includes(v.sortDirection)).slice(-20).map((v: TableView) => ({ ...v, ...clean(v) })) };
  } catch { return empty; }
}

// Keep normal Tab behavior for links, menus, and form controls inside each row.
export function tableKeyboardNavigation(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (target.tagName !== "TR" || !["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Enter" || event.key === " ") { target.click(); return; }
  const rows = Array.from(target.parentElement?.querySelectorAll<HTMLElement>("tr[tabindex]") ?? []);
  const index = rows.indexOf(target);
  rows[event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
}
