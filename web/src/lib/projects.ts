import { request } from "./api";
export type ProjectScope = { clusterId: string; namespace: string };
export type Project = { id: string; name: string; description: string; scopes: ProjectScope[]; revision: number; updatedAt: string };
export const projects = {
 list: () => request<Project[]>("/api/projects"),
 get: (id: string) => request<Project>("/api/projects/" + encodeURIComponent(id)),
 save: (project: Partial<Project>) => request<Project>("/api/projects" + (project.id ? "/" + encodeURIComponent(project.id) : ""), {
  method: project.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project)
 }),
 remove: (id: string) => request<void>("/api/projects/" + encodeURIComponent(id), { method: "DELETE" })
};
