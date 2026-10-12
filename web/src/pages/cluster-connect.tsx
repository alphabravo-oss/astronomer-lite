import { Textarea } from "../components/ui/input";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { dump } from "js-yaml";
import { api, type KubeconfigPreviewResponse } from "../lib/api";
import { PageHeader, PageShell } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { QueryState } from "../components/ui/query-state";

export function ClusterConnectPage({
  onRefresh,
}: {
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [server, setServer] = useState("");
  const [token, setToken] = useState("");
  const [ca, setCA] = useState("");
  const [insecure, setInsecure] = useState(false);
  const [preview, setPreview] = useState<KubeconfigPreviewResponse | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function kubeconfig() {
    const url = new URL(server);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Use an HTTPS Kubernetes API URL without credentials, query parameters, or fragments.",
      );
    if (ca && !ca.includes("-----BEGIN CERTIFICATE-----"))
      throw new Error("Cluster CA must be a PEM certificate.");
    return dump({
      apiVersion: "v1",
      kind: "Config",
      "current-context": name,
      clusters: [
        {
          name,
          cluster: {
            server: url.href.replace(/\/$/, ""),
            ...(ca ? { "certificate-authority-data": btoa(ca) } : {}),
            ...(insecure ? { "insecure-skip-tls-verify": true } : {}),
          },
        },
      ],
      users: [{ name, user: { token } }],
      contexts: [{ name, context: { cluster: name, user: name } }],
    });
  }
  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      setPreview(await api.previewKubeconfig(kubeconfig()));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const added = await api.addKubeconfig(kubeconfig());
      const target = added.find(
        (cluster) => cluster.id === preview?.contexts[0]?.id,
      );
      setToken("");
      await onRefresh();
      navigate(target ? "/clusters/" + target.id : "/");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageShell>
      <PageHeader
        title="Connect with a token"
        description="Connect a Kubernetes API using your service-account or user bearer token."
        actions={
          <Link className="text-sm underline" to="/">
            Back to clusters
          </Link>
        }
      />
      {error && <QueryState error={error} />}
      <form
        onSubmit={check}
        onChange={() => setPreview(null)}
        className="max-w-2xl space-y-4"
      >
        <fieldset
          disabled={busy}
          className="space-y-4 rounded-lg border border-border bg-card p-[var(--card-p)]"
        >
          <label className="block space-y-1 text-sm">
            <span>Connection name</span>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              maxLength={100}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Kubernetes API URL</span>
            <Input
              required
              type="url"
              placeholder="https://cluster.example:6443"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Bearer token</span>
            <Input
              required
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Cluster CA certificate (PEM, optional)</span>
            <Textarea
              disabled={insecure}
              className="min-h-32 p-3 font-mono text-xs"
              value={ca}
              onChange={(e) => setCA(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={insecure}
              onChange={(e) => {
                setInsecure(e.target.checked);
                if (e.target.checked) setCA("");
              }}
            />
            Skip TLS verification for this connection
          </label>
          {insecure && (
            <p className="text-sm text-status-warning">
              The API server’s identity will not be verified. Use only for a
              trusted test cluster.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            The token is saved in your private server workspace. Kubernetes RBAC
            determines what it can do. In shared mode, an administrator must
            allow this API server URL.
          </p>
          <Button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Review connection"}
          </Button>
        </fieldset>
      </form>
      {preview && (
        <section className="max-w-2xl space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Confirm connection</h2>
          <p className="text-sm">
            {name} · {server}
          </p>
          <p className="text-sm text-muted-foreground">
            Save this connection, then check its reachability and permissions in
            the cluster dashboard.
          </p>
          <Button disabled={busy} onClick={() => void connect()}>
            Connect cluster
          </Button>
        </section>
      )}
    </PageShell>
  );
}
