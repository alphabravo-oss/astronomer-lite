import { Textarea, Select } from "../components/ui/input";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { dump } from "js-yaml";
import { api, request, type HelmReleaseSummary } from "../lib/api";
import { PageHeader, PageSection, PageShell } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { QueryState } from "../components/ui/query-state";

type Repository = { id: string; url: string };
type Chart = { name: string; version: string; description: string };
type Plan = {
  digest: string;
  manifest: string;
  defaults: string;
  hooks: { name: string; manifest: string }[];
  release: HelmReleaseSummary;
};
const selectStyle =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function HelmDeployPage() {
  const { clusterId = "", namespace = "", name = "" } = useParams();
  return (
    <HelmDeployForm
      key={clusterId + "/" + namespace + "/" + name}
      clusterId={clusterId}
      initialNamespace={namespace}
      initialName={name}
    />
  );
}

function HelmDeployForm({
  clusterId,
  initialNamespace,
  initialName,
}: {
  clusterId: string;
  initialNamespace: string;
  initialName: string;
}) {
  const navigate = useNavigate();
  const upgrade = !!initialName;
  const base = `/api/clusters/${clusterId}/helm`;
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repository, setRepository] = useState("");
  const [charts, setCharts] = useState<Chart[]>([]);
  const [chartName, setChartName] = useState("");
  const [version, setVersion] = useState("");
  const [search, setSearch] = useState("");
  const [upload, setUpload] = useState(false);
  const [archive, setArchive] = useState("");
  const [name, setName] = useState(initialName);
  const [namespace, setNamespace] = useState(initialNamespace || "default");
  const [createNamespace, setCreateNamespace] = useState(false);
  const [values, setValues] = useState("{}\n");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    request<Repository[]>(base + "/repositories")
      .then((items) => {
        if (active) {
          setRepositories(items);
          setRepository(items[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    if (upgrade)
      api
        .helmRelease(clusterId, initialNamespace, initialName)
        .then((release) => {
          if (active) {
            setValues(dump(release.config ?? {}));
            setChartName(release.chart);
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [base, clusterId, initialName, initialNamespace, upgrade]);
  useEffect(() => {
    if (!repository || upload) return;
    const controller = new AbortController();
    setLoading(true);
    setCharts([]);
    setVersion("");
    setError("");
    request<Chart[]>(base + "/charts?repository=" + repository, {
      signal: controller.signal,
    })
      .then(setCharts)
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, repository, upload]);
  const names = useMemo(
    () => [
      ...new Set(
        charts
          .filter((c) =>
            (c.name + " " + c.description)
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((c) => c.name),
      ),
    ],
    [charts, search],
  );
  const versions = charts.filter((c) => c.name === chartName);
  const ready =
    !!name &&
    !!namespace &&
    (upload ? !!archive : !!repository && !!chartName && !!version);
  function changed() {
    setPlan(null);
    setError("");
  }
  async function readChart(file?: File) {
    changed();
    setArchive("");
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("Chart must be no larger than 20 MiB.");
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read chart"));
        reader.readAsDataURL(file);
      });
      setArchive(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function deploy(dryRun: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await request<Plan>(
        base + (upgrade ? "/upgrade" : "/install"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repository: upload ? "" : repository,
            chart: chartName,
            version,
            archive: upload ? archive : "",
            name,
            namespace,
            values,
            createNamespace,
            dryRun,
            digest: dryRun ? "" : plan?.digest,
          }),
        },
      );
      if (dryRun) setPlan(result);
      else navigate(`/clusters/${clusterId}/helm/releases`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function preview(e: FormEvent) {
    e.preventDefault();
    void deploy(true);
  }
  return (
    <PageShell>
      <PageHeader
        title={upgrade ? "Upgrade Helm release" : "Install Helm chart"}
        description="Choose a chart, configure its values, and review the rendered changes before deploying."
        actions={
          <Link
            className="text-sm underline"
            to={`/clusters/${clusterId}/helm/releases`}
          >
            Back to releases
          </Link>
        }
      />
      {error && <QueryState error={error} />}
      <form onSubmit={preview} onChange={changed} className="space-y-6">
        <fieldset
          disabled={busy}
          className="space-y-4 rounded-lg border border-border bg-card p-[var(--card-p)] disabled:opacity-60"
        >
          <legend className="text-sm font-semibold">Chart source</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={upload}
              onChange={(e) => setUpload(e.target.checked)}
            />
            Upload a packaged chart
          </label>
          {upload ? (
            <label className="block space-y-1 text-sm">
              <span>Chart archive (.tgz)</span>
              <Input
                aria-label="Chart archive (.tgz)"
                type="file"
                accept=".tgz,.gz"
                onChange={(e) => void readChart(e.target.files?.[0])}
              />
              <span className="text-xs text-muted-foreground">
                Maximum 20 MiB. Include packaged dependencies.
              </span>
            </label>
          ) : (
            <>
              <label className="block space-y-1 text-sm">
                <span>Repository</span>
                <Select
                  aria-label="Repository"
                  className={selectStyle}
                  value={repository}
                  onChange={(e) => {
                    setRepository(e.target.value);
                    setChartName("");
                  }}
                >
                  {repositories.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.url}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1 text-sm">
                <span>Search charts</span>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Chart name or description"
                />
              </label>
              <QueryState
                loading={loading}
                empty={
                  !loading && names.length === 0
                    ? "No charts match. Choose another repository, adjust your search, or upload a chart."
                    : undefined
                }
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span>Chart</span>
                    <Select
                      aria-label="Chart"
                      className={selectStyle}
                      value={chartName}
                      onChange={(e) => {
                        setChartName(e.target.value);
                        setVersion("");
                      }}
                    >
                      <option value="">Choose a chart</option>
                      {names.map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Chart version</span>
                    <Select
                      aria-label="Chart version"
                      className={selectStyle}
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                    >
                      <option value="">Choose a version</option>
                      {versions.map((c) => (
                        <option key={c.version}>{c.version}</option>
                      ))}
                    </Select>
                  </label>
                </div>
                <p className="text-sm text-muted-foreground">
                  {versions[0]?.description}
                </p>
              </QueryState>
            </>
          )}
        </fieldset>
        <fieldset
          disabled={busy}
          className="space-y-4 rounded-lg border border-border bg-card p-[var(--card-p)]"
        >
          <legend className="text-sm font-semibold">
            Release configuration
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>Release name</span>
              <Input
                required
                maxLength={53}
                value={name}
                readOnly={upgrade}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Namespace</span>
              <Input
                required
                value={namespace}
                readOnly={upgrade}
                onChange={(e) => setNamespace(e.target.value)}
              />
            </label>
          </div>
          {!upgrade && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createNamespace}
                onChange={(e) => setCreateNamespace(e.target.checked)}
              />
              Create namespace if needed
            </label>
          )}
          <label className="block space-y-1 text-sm">
            <span>Values overrides (YAML)</span>
            <Textarea
              className="min-h-64 p-3 font-mono text-sm"
              value={values}
              onChange={(e) => setValues(e.target.value)}
              spellCheck={false}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            {upgrade
              ? "Current overrides are prefilled. The new chart defaults are merged with these overrides."
              : "Overrides are merged with the selected chart’s defaults."}
          </p>
          <Button disabled={busy || !ready} type="submit">
            {busy ? "Working…" : "Preview changes"}
          </Button>
        </fieldset>
      </form>
      {plan && (
        <PageSection
          title="Review deployment"
          description={`${plan.release.chart} ${plan.release.version} → ${namespace}/${name}`}
        >
          <p className="text-sm text-muted-foreground">
            Helm renders against the cluster without installing anything. Secret
            manifests are hidden. Confirming runs chart hooks and may change
            cluster-wide resources. Helm does not wait for workload readiness;
            inspect the release and workloads after deployment.
          </p>
          <details>
            <summary className="cursor-pointer text-sm">Chart defaults</summary>
            <pre className="max-h-80 overflow-auto rounded border border-border p-3 text-xs">
              {plan.defaults}
            </pre>
          </details>
          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-card p-4 font-mono text-xs">
            {plan.manifest || "No regular manifests."}
          </pre>
          {plan.hooks.map((h, i) => (
            <details key={h.name + i}>
              <summary className="cursor-pointer text-sm">
                Hook: {h.name}
              </summary>
              <pre className="max-h-80 overflow-auto p-3 text-xs">
                {h.manifest}
              </pre>
            </details>
          ))}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void deploy(false)}>
              {upgrade ? "Confirm upgrade" : "Confirm install"}
            </Button>
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => setPlan(null)}
            >
              Cancel
            </Button>
          </div>
        </PageSection>
      )}
    </PageShell>
  );
}
