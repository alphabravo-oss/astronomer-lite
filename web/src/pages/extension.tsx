import headlampRuntime from "../generated/headlamp-runtime.js?raw";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { extensions, type Extension, type PluginRequest } from "../lib/extensions";
import { PageHeader } from "../components/ui/page";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { useTheme } from "../lib/theme";

type Pending = { request: PluginRequest; preview: unknown; reply: (value: unknown, error?: string) => void };

export function ExtensionPage({ selectedNamespaces }: { selectedNamespaces: string[] }) {
  const { clusterId = "", extensionId = "" } = useParams();
  const [plugin, setPlugin] = useState<Extension | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const mutationInFlight = useRef(false);
  const { theme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    setHtml(""); setPlugin(null); setPending(null); setError(""); mutationInFlight.current = false;
    Promise.all([extensions.list(), extensions.bundle(extensionId)]).then(([list, bundle]) => {
      if (cancelled) return;
      setPlugin(list.find((p) => p.id === extensionId) ?? null); setHtml(bundle.html);
    }).catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [extensionId, clusterId]);

  const context = useMemo(() => ({ clusterId, namespaces: selectedNamespaces, theme }), [clusterId, selectedNamespaces, theme]);
  const document = useMemo(() => {
    if (!html) return "";
    const initialContext = JSON.stringify(context).replace(/</g, "\\u003c");
    const runtime = plugin?.runtime === "headlamp-v1" ? `<script>${headlampRuntime.replace(/<\/script/gi, "<\\/script")}</script>` : "";
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><style>:root{color-scheme:${context.theme}}body{font:14px system-ui;margin:20px;color:${context.theme === "dark" ? "#fafafa" : "#18181b"};background:${context.theme === "dark" ? "#18181b" : "#fafafa"}}button{cursor:pointer}</style><script>
      const waiting = new Map(); let sequence = 0;
      const call = (type, request) => {
        return new Promise((resolve,reject) => {
          const id = String(++sequence);
          const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Request timed out')); }, 120000);
          waiting.set(id, {resolve,reject,timer});
          parent.postMessage({type,id,request},'*');
        });
      };
      window.astronomer = { context: ${initialContext}, request: request => call('astronomer:request', request), storage: {get: () => call('astronomer:storage',{verb:'get'}), set: value => call('astronomer:storage',{verb:'set',value})} };
      addEventListener('message', event => {
        if(event.source !== parent || event.data?.type !== 'astronomer:response') return;
        const task = waiting.get(event.data.id); if(!task) return;
        clearTimeout(task.timer); waiting.delete(event.data.id);
        event.data.error ? task.reject(new Error(event.data.error)) : task.resolve(event.data.value);
      });
    </script>${runtime}</head><body>${html}</body></html>`;
  }, [html, context, plugin?.runtime]);

  useEffect(() => {
    let active = true;
    setPending(null);
    mutationInFlight.current = false;
    let reads = 0;
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !["astronomer:request", "astronomer:storage"].includes(event.data?.type) || typeof event.data.id !== "string" || event.data.id.length > 100) return;
      const target = event.source as Window;
      const reply = (value: unknown, error?: string) => { if (active && target === frame.current?.contentWindow) target.postMessage({ type: "astronomer:response", id: event.data.id, value, error }, "*"); };
      if (event.data.type === "astronomer:storage") {
        if (reads >= 8) { reply(null, "Too many concurrent requests"); return; }
        reads++;
        try {
          const data = event.data.request;
          if (data?.verb === "get") reply(await extensions.settings(extensionId));
          else if (data?.verb === "set" && data.value && typeof data.value === "object" && !Array.isArray(data.value)) { await extensions.saveSettings(extensionId, data.value); reply(null); }
          else reply(null, "Invalid plugin settings request");
        } catch (e) { reply(null, String(e)); } finally { reads--; }
        return;
      }
      const request = event.data.request as PluginRequest;
      if (!request || !["get", "list", "apply", "delete"].includes(request.verb)) { reply(null, "Unsupported request"); return; }
      if (reads >= 8) { reply(null, "Too many concurrent requests"); return; }
      const write = request.verb === "apply" || request.verb === "delete";
      if (write && mutationInFlight.current) { reply(null, "Another change is awaiting confirmation"); return; }
      if (write) mutationInFlight.current = true;
      reads++;
      try {
        const result = await extensions.resource(extensionId, clusterId, request, write);
        if (!active) return;
        if (write) setPending({ request, preview: result, reply });
        else reply(result);
      } catch (err) { if (write) mutationInFlight.current = false; reply(null, String(err)); }
      finally { reads--; }
    };
    window.addEventListener("message", receive);
    return () => { active = false; window.removeEventListener("message", receive); };
  }, [extensionId, clusterId, document]);

  function cancelChange() { if (busy) return; pending?.reply(null, "Change cancelled"); setPending(null); mutationInFlight.current = false; }
  async function confirmChange() {
    if (!pending) return; setBusy(true);
    try { pending.reply(await extensions.resource(extensionId, clusterId, pending.request)); }
    catch (err) { pending.reply(null, String(err)); }
    finally { setBusy(false); setPending(null); mutationInFlight.current = false; }
  }
  return <div className="space-y-4">
    <PageHeader title={plugin?.name ?? "Plugin"} description={plugin?.description} eyebrow={plugin ? `Plugin · ${plugin.version}` : undefined} />
    {error ? <p role="alert" className="text-sm text-status-error">{error}</p> : document ? <iframe ref={frame} title={plugin?.name ?? "External plugin"} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} className="h-[calc(100vh-13rem)] w-full rounded-lg border border-border bg-card" /> : <p className="text-sm text-muted-foreground">Loading plugin…</p>}
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) cancelChange(); }}><DialogContent className="max-w-2xl"><DialogTitle>Confirm plugin change</DialogTitle><DialogDescription>{plugin?.name} requests {pending?.request.verb} on {pending?.request.namespace ? `${pending.request.namespace}/` : ""}{pending?.request.name}. The server-side dry-run succeeded. Review the result before continuing.</DialogDescription><pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(pending?.preview, null, 2)}</pre><div className="flex justify-end gap-2"><Button variant="ghost" onClick={cancelChange} disabled={busy}>Cancel</Button><Button variant={pending?.request.verb === "delete" ? "danger" : "default"} onClick={() => void confirmChange()} disabled={busy}>{busy ? "Applying…" : "Confirm change"}</Button></div></DialogContent></Dialog>
  </div>;
}
