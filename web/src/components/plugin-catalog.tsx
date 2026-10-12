import { useState } from "react";
import { extensions, type CatalogPackage, type Extension } from "../lib/extensions";
import { Button } from "./ui/button";
import { PageSection } from "./ui/page";
import { QueryState } from "./ui/query-state";
import { ConfirmDialog } from "./ui/confirm-dialog";

export function PluginCatalog({ installed, onInstalled }: { installed: Extension[]; onInstalled: () => Promise<void> }) {
 const [catalog, setCatalog] = useState<{ configured: boolean; packages: CatalogPackage[] } | null>(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const [pending, setPending] = useState<CatalogPackage | null>(null);
 const [message, setMessage] = useState("");
 async function refresh() {
  setLoading(true); setError("");
  try { setCatalog(await extensions.catalog()); } catch (e) { setError(String(e)); } finally { setLoading(false); }
 }
 async function install() {
  if (!pending) return;
  setLoading(true); setError("");
  try { await extensions.install(pending); await onInstalled(); setMessage(`${pending.manifest.name} ${pending.manifest.version} installed and disabled. Review its permissions above before enabling it.`); setPending(null); }
  catch (e) { setError(String(e)); setPending(null); } finally { setLoading(false); }
 }
 return <PageSection title="Plugin catalog" description="Install and update packages signed by your operator's trusted publisher." actions={<Button variant="secondary" disabled={loading} onClick={() => void refresh()}>Check catalog</Button>}>
  <QueryState loading={loading} error={error} onRetry={() => void refresh()} />
  {message && <p role="status" className="text-sm text-status-success">{message}</p>}
  {catalog && !catalog.configured && <p className="text-sm text-muted-foreground">No signed catalog is configured. Your operator can connect a catalog and its trusted signing key.</p>}
  {catalog?.configured && <div className="grid gap-4 md:grid-cols-2">{catalog.packages.map((p) => {
   const existing = installed.find((i) => i.id === p.manifest.id);
   return <article key={`${p.manifest.id}@${p.manifest.version}`} className="space-y-3 rounded-lg border border-border bg-card p-5">
    <h3 className="text-sm font-semibold">{p.manifest.name} <span className="font-normal text-muted-foreground">{p.manifest.version}</span></h3><p className="text-sm text-muted-foreground">{p.manifest.description}</p>
    {existing && <p className="text-xs text-muted-foreground">Installed: {existing.version}</p>}
    <div className="space-y-1 text-xs">{p.manifest.permissions.map((permission) => <p key={`${permission.group}/${permission.resource}`}>{permission.verbs.join(", ")} · {permission.group || "core"}/{permission.resource}</p>)}</div>
    <Button variant="secondary" disabled={loading || existing?.version === p.manifest.version} onClick={() => setPending(p)}>{existing?.version === p.manifest.version ? "Installed" : existing ? "Review update" : "Review install"} {p.manifest.name}</Button>
   </article>;
  })}</div>}
  <ConfirmDialog open={!!pending} onClose={() => { if (!loading) setPending(null); }} onConfirm={() => void install()} title={`Install ${pending?.manifest.name ?? "plugin"} ${pending?.manifest.version ?? ""}?`} description="The package signature and digest will be checked again. Updating disables the plugin until you explicitly enable the new version. Only install publishers whose code you trust." confirmText="Install package" loading={loading} />
 </PageSection>;
}
