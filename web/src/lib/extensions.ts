import { request } from "./api";
export type Extension = {
  id: string; name: string; version: string; description: string; enabled: boolean;
  runtime?: "headlamp-v1";
  permissions: { group: string; resource: string; verbs: string[] }[];
};
export type PluginRequest = {
  group: string; version: string; resource: string; namespace?: string; name?: string;
  verb: "get" | "list" | "apply" | "delete"; continue?: string; object?: Record<string, unknown>;
};
export type CatalogPackage = { manifest: Extension; url: string; sha256: string };
export const extensions = {
  settings: (id: string) => request<Record<string, unknown>>(`/api/extensions/${encodeURIComponent(id)}/settings`),
  saveSettings: (id: string, value: Record<string, unknown>) => request<void>(`/api/extensions/${encodeURIComponent(id)}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  catalog: () => request<{ configured: boolean; packages: CatalogPackage[] }>("/api/extensions/_catalog"),
  install: (p: CatalogPackage) => request<void>("/api/extensions/_install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.manifest.id, version: p.manifest.version, digest: p.sha256 }) }),
  list: () => request<Extension[]>("/api/extensions"),
  setEnabled: (id: string, enabled: boolean) => request<void>(`/api/extensions/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }),
  bundle: (id: string) => request<{ html: string }>(`/api/extensions/${encodeURIComponent(id)}/bundle`),
  resource: (id: string, clusterId: string, body: PluginRequest, dryRun = false) => request<unknown>(`/api/extensions/${encodeURIComponent(id)}/resources`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, clusterId, dryRun })
  })
};
