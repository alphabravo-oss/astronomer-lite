import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Orbit } from "lucide-react";
import { AuthContext, authRequest, type Session } from "../lib/auth-context";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const next = await authRequest<Session>("session");
      const key = next.user?.id ?? next.mode;
      if (sessionStorage.getItem("astronomer-lite-user") !== key) {
        sessionStorage.removeItem("astronomer-lite-activities");
        sessionStorage.setItem("astronomer-lite-user", key);
      }
      setSession(next);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to check your session",
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const expired = () => window.location.assign("/");
    window.addEventListener("session-expired", expired);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("session-expired", expired);
    };
  }, [refresh]);
  if (!session)
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {error ? (
          <div role="alert">
            {error}{" "}
            <Button variant="secondary" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : (
          "Opening Astronomer Lite…"
        )}
      </div>
    );
  if (session.mode === "server" && !session.user)
    return (
      <Login oidc={session.oidc} proxy={!!session.proxy} onLogin={refresh} />
    );
  return (
    <AuthContext.Provider
      key={session.user?.id ?? session.mode}
      value={session}
    >
      {children}
    </AuthContext.Provider>
  );
}

function Login({
  oidc,
  proxy,
  onLogin,
}: {
  oidc: boolean;
  proxy: boolean;
  onLogin: () => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    new URLSearchParams(window.location.search).has("authError")
      ? "SSO sign-in failed. Try again or use your local account."
      : "",
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authRequest("login", { username, password, code });
      setPassword("");
      setCode("");
      await onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-zinc-950 p-12 text-zinc-50 lg:flex">
        <Brand />
        <div className="max-w-lg">
          <p className="mb-4 text-sm text-zinc-400">
            Your Kubernetes workspace
          </p>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            A clear view of every cluster.
          </h2>
          <p className="mt-5 text-base leading-7 text-zinc-400">
            Explore resources, troubleshoot workloads, and manage your clusters
            with Astronomer Lite.
          </p>
        </div>
        <p className="text-xs text-zinc-500">Built by AlphaBravo</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden">
            <Brand />
          </div>
          <div>
            <h1 className="text-page-title font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to your Astronomer Lite workspace.
            </p>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
            >
              {error}
            </p>
          )}
          {proxy && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await authRequest("proxy", {});
                  await onLogin();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Continue with trusted proxy
            </Button>
          )}
          {oidc && (
            <>
              <a
                href="/api/auth/oidc/login"
                className="flex h-10 items-center justify-center rounded-md border border-border bg-secondary text-sm font-medium hover:bg-accent"
              >
                Continue with SSO
              </a>
              <div className="text-center text-xs text-muted-foreground">
                or use a local account
              </div>
            </>
          )}
          <form onSubmit={submit} className="space-y-4">
            <label className="block space-y-2 text-sm font-medium">
              <span>Username</span>
              <Input
                autoComplete="username"
                name="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full"
              />
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>Password</span>
              <Input
                type="password"
                autoComplete="current-password"
                name="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full"
              />
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>Authenticator or recovery code (if enabled)</span>
              <Input
                autoComplete="one-time-code"
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full"
              />
            </label>
            <Button className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="text-xs leading-5 text-muted-foreground">
            Need an account or a password reset? Contact your Astronomer Lite
            administrator.
          </p>
        </div>
      </section>
    </main>
  );
}
function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600">
        <Orbit className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-sm font-semibold">Astronomer Lite</p>
        <p className="text-xs opacity-60">by AlphaBravo</p>
      </div>
    </div>
  );
}
