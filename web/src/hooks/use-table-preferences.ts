import { useState, type CSSProperties } from "react";
import { useAuth } from "../lib/auth-context";
import { readTablePreferences, type TablePreferences } from "../lib/table-preferences";

export type TableColumn = { key: string; label: string; width?: number; hidden?: boolean };
export function useTablePreferences(id: string, columns: TableColumn[]) {
  const { user } = useAuth();
  const storageKey = `astronomer-lite-table:${user?.id ?? "local"}:${id}`;
  const [stored, setStored] = useState(() => ({ key: storageKey, value: readTablePreferences(storageKey, columns) }));
  const value = stored.key === storageKey ? stored.value : readTablePreferences(storageKey, columns);
  if (stored.key !== storageKey) setStored({ key: storageKey, value });
  function update(next: TablePreferences) {
    setStored({ key: storageKey, value: next });
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Private browsing/quota: keep working in memory. */ }
  }
  function style(key: string, header = false): CSSProperties {
    const width = value.widths[key] ?? columns.find((c) => c.key === key)?.width ?? 160;
    const index = columns.findIndex((c) => c.key === key);
    const left = columns.slice(0, index).filter((c) => value.pinned.includes(c.key) && !value.hidden.includes(c.key)).reduce((n, c) => n + (value.widths[c.key] ?? c.width ?? 160), 0);
    return { display: value.hidden.includes(key) ? "none" : undefined, width, minWidth: width, maxWidth: width,
      ...(value.pinned.includes(key) ? { position: "sticky", left, zIndex: 2, background: header ? "color-mix(in srgb, hsl(var(--muted)) 72%, hsl(var(--card)))" : "hsl(var(--card))", boxShadow: "1px 0 hsl(var(--border))" } : {}) };
  }
  return { columns, value, update, style };
}
