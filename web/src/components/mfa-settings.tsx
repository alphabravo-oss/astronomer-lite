import { useState, type FormEvent } from "react";
import { authRequest, useAuth, type User } from "../lib/auth-context";
import { PageSection } from "./ui/page";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { QueryState } from "./ui/query-state";

export function MFASettings() {
 const { user } = useAuth();
 const [enabled, setEnabled] = useState(!!user?.mfaEnabled);
 const [password, setPassword] = useState("");
 const [code, setCode] = useState("");
 const [secret, setSecret] = useState("");
 const [recovery, setRecovery] = useState<string[]>([]);
 const [error, setError] = useState("");
 const [message, setMessage] = useState("");
 const [busy, setBusy] = useState(false);
 if (user?.provider !== "local") return null;
 async function change(event: FormEvent) {
  event.preventDefault(); setBusy(true); setError(""); setMessage("");
  try {
   if (!enabled && !secret) {
    const result = await authRequest<{ secret: string }>("mfa/begin", { password });
    setSecret(result.secret); setRecovery([]);
   } else {
    const result = await authRequest<{ user: User; recoveryCodes: string[] }>(enabled ? "mfa/disable" : "mfa/enable", { password, code });
    setEnabled(!!result.user.mfaEnabled); setRecovery(result.recoveryCodes ?? []);
    setSecret(""); setPassword(""); setCode("");
    setMessage(result.user.mfaEnabled ? "Two-factor authentication enabled. Other sessions were signed out." : "Two-factor authentication disabled. Other sessions were signed out.");
   }
  } catch (e) { setError(String(e)); } finally { setBusy(false); }
 }
 return <PageSection title="Two-factor authentication" description="Protect local sign-in with a time-based authenticator app and one-use recovery codes.">
  <form onSubmit={change} className="max-w-2xl space-y-4 rounded-lg border border-border bg-card p-[var(--card-p)]">
   <p className="text-sm font-medium">{enabled ? "Authenticator enabled" : "Authenticator not enabled"}</p>
   {error && <QueryState error={error} />}
   {message && <p role="status" className="text-sm text-status-success">{message}</p>}
   <label className="block space-y-1 text-sm"><span>Password to manage MFA</span><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
   {secret && <div className="space-y-2 text-sm"><p>Add a time-based account in your authenticator app using this key (6 digits, 30 seconds, SHA-1), then enter its code. Setup expires after five minutes.</p><code className="block break-all rounded border border-border bg-muted p-3">{secret}</code></div>}
   {(enabled || secret) && <label className="block space-y-1 text-sm"><span>{enabled ? "Authenticator or recovery code" : "New authenticator code"}</span><Input autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></label>}
   <div className="flex gap-2"><Button disabled={busy} variant={enabled ? "danger" : "secondary"}>{busy ? "Working…" : enabled ? "Disable two-factor authentication" : secret ? "Enable two-factor authentication" : "Set up authenticator"}</Button>{secret && <Button type="button" variant="ghost" onClick={() => { setSecret(""); setCode(""); setPassword(""); }}>Cancel setup</Button>}</div>
  </form>
  {recovery.length > 0 && <div className="max-w-2xl space-y-3 rounded-lg border border-status-warning/30 bg-status-warning/10 p-5"><h3 className="text-sm font-semibold">Save your recovery codes</h3><p className="text-sm">Each code works once in place of an authenticator code. Keep them somewhere private. These codes are shown only now.</p><pre className="overflow-auto text-xs">{recovery.join("\n")}</pre><Button variant="secondary" onClick={() => setRecovery([])}>I have saved my codes</Button></div>}
 </PageSection>;
}
