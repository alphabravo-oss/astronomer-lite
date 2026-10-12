import { resourceConfigs } from "./resources";

export function resourceLink(clusterId: string, target: { resource: string; name: string; namespace?: string; apiVersion?: string }) {
  const match = resourceConfigs.find((config) => config.resource === target.resource && (!target.apiVersion || `${config.apiGroup ? `${config.apiGroup}/` : ""}${config.version}` === target.apiVersion));
  const route = target.resource === "pods" ? "pods" : match?.route ?? "resources";
  const params = new URLSearchParams({ name: target.name });
  if (target.namespace) params.set("namespace", target.namespace);
  if (route === "resources") {
    params.set("q", target.resource);
    if (target.apiVersion) params.set("apiVersion", target.apiVersion);
  }
  return `/clusters/${encodeURIComponent(clusterId)}/${route}?${params}`;
}
