import { resourceConfigs } from "./resources";

const collections = new Set([
  ...resourceConfigs.map((resource) => resource.route),
  "pods",
  "resources",
  "events",
  "releases",
  "topology",
  "logs",
  "exec",
  "attach",
]);

/** Match Astronomer's full-width operator surfaces and contained reading pages. */
export function contentLayout(pathname: string, search = "") {
  const params = new URLSearchParams(search);
  const view = params.get("tab") ?? params.get("view");
  return pathname === "/" ||
    collections.has(pathname.split("/").at(-1) ?? "") ||
    view === "yaml" ||
    view === "logs"
    ? "full-bleed"
    : "contained";
}
