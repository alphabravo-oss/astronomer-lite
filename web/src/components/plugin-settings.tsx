import { useEffect, useState } from "react";
import { Puzzle, Shield } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { extensions, type Extension } from "../lib/extensions";
import { PageSection } from "./ui/page";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { PluginCatalog } from "./plugin-catalog";
export function PluginSettings() {
  const session = useAuth();
  const admin =
    session.mode === "single-user" || session.user?.role === "admin";
  const [plugins, setPlugins] = useState<Extension[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      setPlugins(await extensions.list());
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function togglePlugin(plugin: Extension) {
    setBusy(true);
    setError("");
    try {
      await extensions.setEnabled(plugin.id, !plugin.enabled);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}
      <PageSection
        title="Plugins"
        description={
          admin
            ? "Review each installed plugin's permissions before enabling it. Enabled plugins appear inside each cluster."
            : "Plugins installed and enabled by your administrator."
        }
      >
        {plugins.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <Puzzle className="mx-auto mb-3 h-6 w-6" />
            No external plugins installed.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {plugins.map((plugin) => (
              <article
                key={plugin.id}
                className="space-y-4 rounded-lg border border-border bg-card p-[var(--card-p)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{plugin.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {plugin.version}
                    </p>
                  </div>
                  <Badge tone={plugin.enabled ? "success" : "muted"}>
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {plugin.description}
                </p>
                <div className="space-y-2 rounded-md bg-muted/40 p-3">
                  <p className="flex items-center gap-2 text-xs font-medium">
                    <Shield className="h-3.5 w-3.5" />
                    Requested permissions
                  </p>
                  {plugin.permissions.map((p) => (
                    <p
                      key={`${p.group}/${p.resource}`}
                      className="break-words font-mono text-xs text-muted-foreground"
                    >
                      {p.verbs.join(", ")} · {p.group || "core"}/{p.resource}
                    </p>
                  ))}
                </div>
                {admin && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void togglePlugin(plugin)}
                  >
                    {plugin.enabled ? "Disable" : "Enable"} {plugin.name}
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </PageSection>
      {admin && <PluginCatalog installed={plugins} onInstalled={refresh} />}
    </>
  );
}
