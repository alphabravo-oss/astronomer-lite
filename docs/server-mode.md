# Local accounts and optional OIDC

Server mode keeps the single-process, single-container architecture. It adds application identities and one private kubeconfig workspace per user. Local username/password login is always available; SSO is optional.

## Start with local login

Create a private directory and a bootstrap password of 12–72 bytes. For Compose, the mounted file must be readable by the container's unprivileged user; keep the host directory private:

```bash
mkdir -m 700 .secrets
openssl rand -base64 24 > .secrets/bootstrap-password
chmod 444 .secrets/bootstrap-password
export ASTRONOMER_LITE_ADMIN_PASSWORD_FILE="$PWD/.secrets/bootstrap-password"
export ASTRONOMER_LITE_PUBLIC_URL=http://localhost:8080
# Exact URLs appearing in your users' kubeconfigs, comma-separated:
export ASTRONOMER_LITE_ALLOWED_CLUSTER_SERVERS=https://your-api-server:6443
docker compose -f docker-compose.server.yml up -d --build
```

Open the configured public URL and sign in as `admin` with that file's password. In Settings, create users or administrators, reset passwords, and disable accounts. Plugin management appears only after an operator explicitly enables the deferred runtime. Local users can change their own passwords. There is no public registration or email password-reset service.

The bootstrap file is used only when the account store is empty; changing it later does not reset the administrator. Use Settings for resets. Keep at least two local administrators for recovery. The last active administrator cannot be disabled or demoted.

For a native binary, set the same variables plus `ASTRONOMER_LITE_AUTH_MODE=server` and run `server/bin/astronomer-lite`. Native password files may use mode `0600` under the process owner.

## Identity and cluster access

- `admin` manages app users and plugin enablement. `user` manages their own cluster connections. Neither role grants Kubernetes privileges or access to another user's workspace.
- Server mode ignores host `KUBECONFIG` and `~/.kube/config`. Each user imports their own kubeconfigs. Existing single-user credentials are not automatically migrated.
- Imported server URLs must exactly match `ASTRONOMER_LITE_ALLOWED_CLUSTER_SERVERS`. Empty means imports are denied. TLS inline certificate data and inline bearer tokens are supported. Arbitrary exec commands, auth-provider helpers, file references, and per-kubeconfig proxies are rejected. Operators may explicitly authorize the constrained credential helpers described below.
- Kubernetes remains the final authorization authority. App OIDC tokens are not automatically forwarded to Kubernetes. Inline cluster credential rotation requires reimporting the connection; approved helpers can return expiring credentials.
- Account state and password hashes live in `users.json`; user credentials live under `users/<identity-id>/clusters.d`. Files are permission-restricted, but kubeconfig credentials are not encrypted at rest. Protect and back up the config volume.

## Optional OIDC

Configure `ASTRONOMER_LITE_OIDC_ISSUER` and `ASTRONOMER_LITE_OIDC_CLIENT_ID`. Register this exact callback URL with your provider:

```
https://lite.example.com/api/auth/oidc/callback
```

For confidential clients, also set `ASTRONOMER_LITE_OIDC_CLIENT_SECRET_FILE`. With Compose, use the optional override:

```bash
export ASTRONOMER_LITE_OIDC_CLIENT_SECRET_FILE="$PWD/.secrets/oidc-client-secret"
docker compose -f docker-compose.server.yml -f docker-compose.oidc.yml up -d
```

Use the same private-directory/readable-file arrangement as the bootstrap secret. The flow uses authorization code, PKCE S256, nonce and one-use state, and validates the ID token signature, issuer, audience, and expiration. New SSO identities receive the `user` role unless configured admin groups match; restrict application assignment at your provider. Identity is keyed by issuer and subject, not a mutable display name or email. An OIDC identity and a similarly named local account are separate accounts.

Discovery happens on the first SSO attempt. Provider downtime does not prevent startup or local login. OIDC sessions have an eight-hour maximum. By default Lite requests offline access and refreshes expiring identity tokens when the provider returns a refresh token. Each refreshed ID token is verified again, including stable issuer/subject and configured groups. Providers must return a new ID token on refresh; missing/invalid tokens revoke the session. Without a refresh token the ID-token expiry caps the session. Refresh credentials remain in process memory and are lost on restart. Provider-initiated logout is not implemented. A real Dex 2.43.0 container was verified for login and refresh; provider-specific production configuration still needs testing.

## Deployment settings

| Variable | Purpose |
|---|---|
| `ASTRONOMER_LITE_AUTH_MODE` | `single-user` (default) or `server`. |
| `ASTRONOMER_LITE_PUBLIC_URL` | Exact browser origin, root path. HTTPS required except localhost. |
| `ASTRONOMER_LITE_ADMIN_USER` | Initial local admin username, default `admin`. |
| `ASTRONOMER_LITE_ADMIN_PASSWORD_FILE` | Initial local password file; no default password. |
| `ASTRONOMER_LITE_ALLOWED_CLUSTER_SERVERS` | Comma/newline-separated exact Kubernetes API URLs allowed in server mode. |
| `ASTRONOMER_LITE_OIDC_ISSUER` | Optional issuer URL. |
| `ASTRONOMER_LITE_OIDC_CLIENT_ID` | OIDC application ID. |
| `ASTRONOMER_LITE_OIDC_CLIENT_SECRET_FILE` | Optional confidential-client secret file. |
| `ASTRONOMER_LITE_PLUGINS_ENABLED` | `false` by default. Set `true` to opt into the deferred plugin runtime/UI. |
| `ASTRONOMER_LITE_PLUGINS_DIR` | Operator-managed plugin directory. |

Serve UI and API at the same root origin. A remote deployment needs an HTTPS reverse proxy supporting WebSocket upgrades. The Compose host port binds to loopback. Forwarded client addresses are accepted only from explicitly configured trusted proxy CIDRs. The forwarded chain is evaluated from the trusted peer toward the first untrusted address. Login limits are 10 attempts/minute per client-and-username and 100/minute per client globally; other authentication endpoints have their own limits. Configure upstream limits as well.

Sessions use HttpOnly, SameSite cookies, Secure on HTTPS, and in-memory state. Restarting the process signs everyone out. Password resets/changes and account changes revoke sessions; logout revokes the current session. Active WebSockets and session-owned port-forwards close on revocation/expiry. Mutations require the app request header and matching browser origin. Run one process against each config directory. An OS file lock rejects a second process sharing that directory; this is a single-instance guard, not distributed coordination. Multiple replicas/shared state are intentionally out of scope.

Port-forwards bind loopback. The optional browser gateway below makes them accessible to remote users over HTTPS.

## Local MFA and group mapping

Local users can enroll a TOTP authenticator in Settings using the displayed secret. Enrollment requires their password and a current six-digit code. Eight one-use recovery codes are displayed once. Enabling/disabling MFA revokes sessions; login then requires the password plus a TOTP or recovery code. Disabling requires password and code. Admin password resets do not remove MFA. Keep recovery codes and another active administrator available; there is no email recovery service.

OIDC configuration:

| Variable | Default / behavior |
|---|---|
| `ASTRONOMER_LITE_OIDC_REFRESH` | `true`; set `false` to cap sessions at ID-token expiration |
| `ASTRONOMER_LITE_OIDC_GROUPS_CLAIM` | `groups`, a top-level string-array claim |
| `ASTRONOMER_LITE_OIDC_ADMIN_GROUPS` | Comma/newline-separated exact groups granting app admin |
| `ASTRONOMER_LITE_OIDC_REQUIRED_GROUPS` | At least one exact group must match if configured |
| `ASTRONOMER_LITE_TRUSTED_PROXIES` | Comma/newline-separated direct-peer IP CIDRs |

Group matching is case-sensitive. Group roles are reevaluated on login/refresh; loss of required access or role changes revoke existing sessions. Group mapping does not grant Kubernetes credentials or permissions.

## Identity-aware proxy

Set `ASTRONOMER_LITE_PROXY_USER_HEADER` and optionally `ASTRONOMER_LITE_PROXY_GROUPS_HEADER` to distinct dedicated `X-*` headers, plus trusted direct-peer CIDRs. Optional `ASTRONOMER_LITE_PROXY_ADMIN_GROUPS` and `ASTRONOMER_LITE_PROXY_REQUIRED_GROUPS` use the same exact-match rules. The login page offers **Continue with trusted proxy**. Proxy identities have separate workspaces from similarly named local/OIDC users.

The proxy must authenticate users, strip client-supplied identity headers and set its own values on every request, including WebSocket upgrades. The backend must be reachable only through that proxy. Lite checks the direct peer, identity and required groups again on every proxy-session request; a cookie alone cannot bypass those checks. In-flight streams cannot continuously query proxy policy, so the proxy must terminate existing connections for immediate upstream revocation. Local account login remains available.

## Approved cloud credential helpers

Set `ASTRONOMER_LITE_CREDENTIAL_HELPERS_FILE` to a private, operator-owned JSON policy. Commands and credentials must be provisioned by the operator, never uploaded by an app user:

```json
{
  "helpers": [{
    "id": "team-cloud",
    "users": ["EXACT_64_HEX_APP_USER_ID"],
    "servers": ["https://cluster.example.com:6443"],
    "command": "/opt/lite-helpers/cluster-token",
    "args": ["fixed-cluster-name"],
    "env": {"CLOUD_PROFILE": "team-a"}
  }]
}
```

Use the ID from the user's account record/API, an absolute executable path and fixed arguments/environment. The imported kubeconfig auth entry uses only:

```yaml
exec:
  apiVersion: client.authentication.k8s.io/v1
  command: astronomer-lite-helper:team-cloud
  interactiveMode: Never
```

No user-supplied arguments, environment, cluster-info request or additional inline credentials are allowed. The exact user and API URL must match the policy and the server allowlist. The wrapper runs without a shell, with a private per-user/helper HOME, no ambient cloud credentials, a 30-second deadline and a 1 MiB output limit. It requires a valid v1 ExecCredential with token or certificate/key and an expiry no more than 24 hours ahead. Helper stderr is not returned to clients. Provide any required runtime environment explicitly in the policy; install cloud tools yourself. Tests use a controlled helper; AWS/Azure/GCP account flows have not been verified.

## Remote browser port-forward gateway

Set `ASTRONOMER_LITE_FORWARD_DOMAIN=forward.example.net` with an HTTPS public app URL such as `https://lite.example.com`. Use a **different registrable domain** from the app: `*.forward.example.com` alongside `lite.example.com` is rejected. Route wildcard DNS and TLS for `*.forward.example.net` to the same Lite process, preserving Host and WebSocket upgrades. The suffix is a domain only, without scheme, port or wildcard.

The port-forward UI's Open action issues a short-lived, one-use link for a random hostname. Redeeming it sets a host-only Secure/HttpOnly cookie, loads a minimal same-origin handoff document, removes the ticket from the URL and proxies HTTP/WebSocket traffic to the loopback forward. App cookies are not forwarded. Logout, session expiry, stop and forward TTL revoke gateway access and active sockets. This supports browser HTTP(S)/WebSocket applications, not arbitrary public TCP exposure. Real HTTP/WebSocket gateway tests pass; public wildcard DNS/TLS deployment has not been exercised here.

## Helm repositories and workspace backup

`ASTRONOMER_LITE_HELM_REPOSITORIES` accepts comma/newline-separated trusted HTTP(S) chart repository URLs. Defaults are prometheus-community and metrics-server. Catalog entries may refer to archives on another host, so only configure repositories you trust. Users can also upload an application-chart archive. Install/upgrade previews render the selected chart and values before confirmation; Helm still enforces Kubernetes permissions during execution. Preview does not validate every resulting object against all admission policies or wait for workloads to become ready.

Stop Lite before backing up its entire config directory and managed plugin directory. These contain password hashes, MFA secrets, cluster credentials, projects and plugin settings. Restore to one process only. Sessions and OIDC refresh tokens are intentionally not restored. File permissions limit access; data is not encrypted at rest.
