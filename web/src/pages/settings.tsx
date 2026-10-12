import { Select } from "../components/ui/input";
import { LogOut, Plus, UserRound } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { MFASettings } from "../components/mfa-settings";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { PageHeader, PageSection, PageShell } from "../components/ui/page";
import { authRequest, logout, useAuth, type User } from "../lib/auth-context";

const PluginSettings = lazy(() =>
  import("../components/plugin-settings").then((module) => ({
    default: module.PluginSettings,
  })),
);

export function SettingsPage() {
  const session = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  async function refresh() {
    try {
      if (session.user?.role === "admin")
        setUsers(await authRequest<User[]>("users"));
    } catch (err) {
      setError(String(err));
    }
  }
  useEffect(() => {
    void refresh();
  }, [session.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await authRequest("password", { current, password });
      setPassword("");
      setCurrent("");
      setMessage("Password updated. Other sessions have been signed out.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="Manage your account and workspace."
        actions={
          session.user ? (
            <Button
              variant="secondary"
              onClick={() =>
                void logout().catch((err) => setError(String(err)))
              }
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          ) : undefined
        }
      />
      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-status-success">
          {message}
        </p>
      )}
      <MFASettings />
      <PageSection title="Your account">
        <div className="rounded-lg border border-border bg-card p-[var(--card-p)]">
          <div className="flex items-center gap-3">
            <UserRound className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                {session.user?.username ?? "Local workspace"}
              </p>
              <p className="text-xs text-muted-foreground">
                {session.user
                  ? `${session.user.role} · ${session.user.provider === "oidc" ? "Single sign-on" : session.user.provider === "proxy" ? "Trusted proxy" : "Local account"}`
                  : "Single-user mode"}
              </p>
            </div>
          </div>
          {session.user?.provider === "local" && (
            <form
              onSubmit={changePassword}
              className="mt-5 flex max-w-2xl flex-wrap items-end gap-3"
            >
              <label className="space-y-1 text-sm">
                <span className="block">Current password</span>
                <Input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block">New password</span>
                <Input
                  required
                  minLength={12}
                  maxLength={72}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <Button variant="secondary" disabled={busy}>
                Change password
              </Button>
            </form>
          )}
        </div>
      </PageSection>
      {session.user?.role === "admin" && (
        <PageSection
          title="Users"
          description="App roles control account administration. Cluster permissions come from each user's Kubernetes credentials."
          actions={
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" />
              Add user
            </Button>
          }
        >
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="k8s-table">
              <thead className="k8s-thead">
                <tr>
                  {["User", "Sign-in", "Role", "Status", ""].map((label) => (
                    <th key={label} className="k8s-th">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="k8s-row">
                    <td className="k8s-td-name">{user.username}</td>
                    <td className="k8s-td-muted">
                      {user.provider === "oidc"
                        ? "SSO"
                        : user.provider === "proxy"
                          ? "Proxy"
                          : "Local"}
                    </td>
                    <td className="k8s-td">{user.role}</td>
                    <td className="k8s-td">
                      <Badge tone={user.disabled ? "muted" : "success"}>
                        {user.disabled ? "Disabled" : "Active"}
                      </Badge>
                    </td>
                    <td className="k8s-td-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(user)}
                        aria-label={`Edit ${user.username}`}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PageSection>
      )}
      {session.plugins && (
        <Suspense fallback={null}>
          <PluginSettings />
        </Suspense>
      )}
      <UserDialog
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={async (id) => {
          setEditing(null);
          if (id === session.user?.id) {
            window.location.assign("/");
          } else {
            await refresh();
          }
        }}
      />
    </PageShell>
  );
}

function UserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User | "new" | null;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setError("");
  }, [user]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await authRequest<User>(
        "users",
        {
          id: user && user !== "new" ? user.id : undefined,
          username: data.get("username") ?? "",
          password: data.get("password") ?? "",
          role: data.get("role"),
          disabled: data.get("disabled") === "on",
        },
        user === "new" ? "POST" : "PATCH",
      );
      await onSaved(result.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>
          {user === "new" ? "Add user" : `Edit ${user?.username ?? "user"}`}
        </DialogTitle>
        <DialogDescription>
          Passwords require 12–72 bytes. Changes to an existing account sign out
          its active sessions.
        </DialogDescription>
        <form
          key={user === "new" ? "new" : user?.id}
          onSubmit={submit}
          className="space-y-4"
        >
          {user === "new" && (
            <label className="block space-y-1 text-sm">
              <span>Username</span>
              <Input
                className="w-full"
                name="username"
                required
                minLength={3}
                maxLength={64}
                autoComplete="off"
              />
            </label>
          )}
          {(user === "new" || user?.provider === "local") && (
            <label className="block space-y-1 text-sm">
              <span>
                {user === "new" ? "Password" : "Reset password (optional)"}
              </span>
              <Input
                className="w-full"
                name="password"
                type="password"
                required={user === "new"}
                minLength={12}
                maxLength={72}
                autoComplete="new-password"
              />
            </label>
          )}
          <label className="block space-y-1 text-sm">
            <span>Role</span>
            <Select
              name="role"
              defaultValue={user && user !== "new" ? user.role : "user"}
              className="text-sm"
            >
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </Select>
          </label>
          {user && user !== "new" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                name="disabled"
                type="checkbox"
                defaultChecked={user.disabled}
              />
              Disable account
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-status-error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button disabled={busy}>{busy ? "Saving…" : "Save user"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
