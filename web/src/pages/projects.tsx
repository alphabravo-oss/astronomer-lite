import { Textarea, Select } from "../components/ui/input";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { load, dump } from "js-yaml";
import { type Cluster } from "../lib/api";
import { projects, type Project, type ProjectScope } from "../lib/projects";
import { PageHeader, PageShell } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { QueryState } from "../components/ui/query-state";

export function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setItems(await projects.list());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const shown = items.filter((p) =>
    (p.name + " " + p.description).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <PageShell>
      <PageHeader
        title="Projects"
        description="Organize your clusters and namespaces into focused workspaces."
        actions={
          <Link
            to="/projects/new"
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Create project
          </Link>
        }
      />
      <Input
        aria-label="Search projects"
        placeholder="Search projects"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <QueryState
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        empty={
          shown.length === 0
            ? "No projects found. Create a project to group clusters and namespaces."
            : undefined
        }
        action={
          <Link className="underline" to="/projects/new">
            Create project
          </Link>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((p) => (
            <Link
              key={p.id}
              to={"/projects/" + p.id}
              className="space-y-2 rounded-lg border border-border bg-card p-[var(--card-p)] hover:bg-muted/30"
            >
              <h2 className="text-base font-semibold">{p.name}</h2>
              <p className="text-sm text-muted-foreground">{p.description}</p>
              <p className="text-sm">
                {new Set(p.scopes.map((s) => s.clusterId)).size} clusters ·{" "}
                {p.scopes.length} namespaces
              </p>
            </Link>
          ))}
        </div>
      </QueryState>
    </PageShell>
  );
}

export function ProjectFormPage({ clusters }: { clusters: Cluster[] }) {
  const { projectId = "" } = useParams();
  return (
    <ProjectForm key={projectId} projectId={projectId} clusters={clusters} />
  );
}
function ProjectForm({
  projectId,
  clusters,
}: {
  projectId: string;
  clusters: Cluster[];
}) {
  const navigate = useNavigate();
  const [record, setRecord] = useState<Partial<Project>>({
    name: "",
    description: "",
    scopes: [],
  });
  const [scopeCluster, setScopeCluster] = useState("");
  const [scopeNamespace, setScopeNamespace] = useState("default");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!projectId);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState("");
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    projects
      .get(projectId)
      .then((p) => {
        if (active) setRecord(p);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  const scopes = record.scopes ?? [];
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await projects.save(record);
      navigate("/projects/" + saved.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function addScope() {
    const clusterId = scopeCluster || clusters[0]?.id;
    if (!clusterId || !scopeNamespace.trim()) return;
    const scope: ProjectScope = { clusterId, namespace: scopeNamespace.trim() };
    if (
      scopes.some(
        (s) =>
          s.clusterId === scope.clusterId && s.namespace === scope.namespace,
      )
    )
      return;
    setRecord({ ...record, scopes: [...scopes, scope] });
  }
  function importProject() {
    try {
      const value = load(importText) as Partial<Project>;
      if (
        !value ||
        typeof value.name !== "string" ||
        !Array.isArray(value.scopes)
      )
        throw new Error("Expected a project with name and scopes");
      if (
        !value.scopes.every(
          (s) =>
            typeof s?.clusterId === "string" &&
            typeof s?.namespace === "string",
        )
      )
        throw new Error("Each scope needs a clusterId and namespace");
      setRecord({
        ...record,
        name: value.name,
        description:
          typeof value.description === "string" ? value.description : "",
        scopes: value.scopes.map((s) => ({
          clusterId: s.clusterId,
          namespace: s.namespace,
        })),
      });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <PageShell>
      <PageHeader
        title={projectId ? "Edit project" : "Create project"}
        description="Projects organize your own workspace; Kubernetes permissions still control access."
        actions={
          <Link
            className="text-sm underline"
            to={projectId ? "/projects/" + projectId : "/projects"}
          >
            Cancel
          </Link>
        }
      />
      {error && <QueryState error={error} />}
      <QueryState
        loading={loading}
        error={projectId && !record.id ? error : undefined}
      >
        <form onSubmit={save} className="max-w-3xl space-y-5">
          <fieldset
            disabled={busy}
            className="space-y-4 rounded-lg border border-border bg-card p-[var(--card-p)]"
          >
            <label className="block space-y-1 text-sm">
              <span>Project name</span>
              <Input
                required
                maxLength={100}
                value={record.name}
                onChange={(e) => setRecord({ ...record, name: e.target.value })}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Description</span>
              <Input
                maxLength={2000}
                value={record.description}
                onChange={(e) =>
                  setRecord({ ...record, description: e.target.value })
                }
              />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-sm">
                <span className="block">Cluster</span>
                <Select
                  aria-label="Cluster"
                  className="max-w-80 px-3"
                  value={scopeCluster || clusters[0]?.id || ""}
                  onChange={(e) => setScopeCluster(e.target.value)}
                >
                  {clusters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block">Namespace</span>
                <Input
                  value={scopeNamespace}
                  onChange={(e) => setScopeNamespace(e.target.value)}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={scopes.length >= 32 || clusters.length === 0}
                onClick={addScope}
              >
                Add scope
              </Button>
            </div>
            <ul className="space-y-2">
              {scopes.map((s, i) => (
                <li
                  key={s.clusterId + "/" + s.namespace}
                  className="flex items-center justify-between gap-3 rounded border border-border p-3 text-sm"
                >
                  <span>
                    {clusters.find((c) => c.id === s.clusterId)?.name ??
                      "Unavailable cluster"}{" "}
                    / {s.namespace}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove scope ${s.namespace}`}
                    onClick={() =>
                      setRecord({
                        ...record,
                        scopes: scopes.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <Button disabled={busy || scopes.length === 0} type="submit">
              {busy ? "Saving…" : "Save project"}
            </Button>
          </fieldset>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm">
              Import project YAML
            </summary>
            <p className="text-sm text-muted-foreground">
              Use cluster IDs from this workspace. Import replaces the form
              fields; save to persist.
            </p>
            <Textarea
              aria-label="Project YAML"
              className="min-h-40 rounded p-3 font-mono text-xs"
              placeholder={dump({
                name: "My project",
                scopes: [
                  { clusterId: "your-cluster-id", namespace: "default" },
                ],
              })}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <Button
              disabled={busy}
              variant="secondary"
              type="button"
              onClick={importProject}
            >
              Import into form
            </Button>
          </details>
        </form>
      </QueryState>
    </PageShell>
  );
}
