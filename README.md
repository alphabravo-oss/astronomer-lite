# Astronomer Lite

A Headlamp-style Kubernetes UI with Astronomer styling and Astronomer Lite branding. Run one container or the desktop application, connect kubeconfigs, and manage multiple clusters.

> **Status:** Alpha — Core cluster management, local multi-user login and optional OIDC are implemented, including Helm, topology, metrics, exec/logs/port-forward and YAML editing with server-side dry-run. External plugins are deferred and disabled by default. See [`docs/STATUS.md`](docs/STATUS.md) for implemented features, verification and release limits.
> **Spec:** [`docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui.md`](docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui.md)

## What it is

`astronomer-lite` is the lightweight cousin of [`astronomer`](../astronomer-all/astronomer). Same visual language as the full astronomer, but architecturally minimal:

- **No agents.** No reverse tunnels. No central database. No multi-process coordination.
- **Direct kubeconfig-based access** to every cluster, just like Headlamp.
- **One application instance.** Run a container or the desktop package; state stays in files.

## Why

`astronomer-go`'s full architecture (server + agent + tunnel + worker + Postgres + RBAC + ArgoCD) is overkill when you just want to point a UI at a few clusters you already have kubeconfigs for. Headlamp solves that minimally but doesn't match our team's design language. `astronomer-lite` bridges the gap.

## Architecture

| Layer | Choice |
|---|---|
| Frontend | Vite + React SPA, reusing Tailwind tokens and layout patterns from [`../astronomer-all/astronomer/frontend`](../astronomer-all/astronomer/frontend) |
| Backend | Go + `client-go`, embeds Vite build via `embed.FS` |
| API style | Thin REST proxy `/api/clusters/{id}/...` → forwards to that cluster's API server (using its `rest.Config`) |
| Live data | One WebSocket per stream (watch / logs / exec / attach) |
| Storage | Flat files under `~/.config/astronomer-lite/` — no DB |
| Caching | Per-cluster informer factories, TTL caches for OpenAPI / discovery / Prometheus detection / Helm getters |
| Distribution | Container, native Go build, Electron desktop installers |

## Quickstart

### Docker Compose (recommended)

```bash
docker compose up -d
open http://localhost:8080
```

The compose file mounts `~/.kube` read-only and persists app-managed state to a named volume. Override the host port with `ASTRONOMER_LITE_PORT=18080 docker compose up -d`. Rebuild from your checkout with `docker compose build`.

### Desktop

Build native installers with `make desktop` after `(cd web && npm ci)`. Linux AppImage/deb, RHEL 8/9/10 RPM, Windows x64 NSIS, and Intel/Apple Silicon Mac ZIP packages are available. RPM installation/runtime checks pass on Red Hat UBI 8/9/10; native Mac/Windows execution and signing remain release checks. See [desktop setup and release limits](docs/desktop.md).

### Multi-user server mode

Use [`docker-compose.server.yml`](docker-compose.server.yml) for local username/password accounts, optional OIDC, and isolated per-user kubeconfigs. See [server setup](docs/server-mode.md) for bootstrap credentials, allowed cluster servers, HTTPS, and SSO configuration. The default compose deployment remains a local, unauthenticated single-user console.

### Plain `docker run`

```bash
docker run \
  -p 127.0.0.1:8080:8080 \
  -v ~/.kube:/home/astronomer/.kube:ro \
  -v astronomer-lite-config:/home/astronomer/.config/astronomer-lite \
  astronomer-lite:dev
```

### Build your own image first

```bash
make image
make image-size
```

Every context in your `~/.kube/config` shows up as a cluster on first boot. Add more from the UI via file upload or pasted YAML; app-managed kubeconfigs live under `/home/astronomer/.config/astronomer-lite/clusters.d` in the mounted volume.

If your kubeconfig uses an exec plugin such as `gke-gcloud-auth-plugin`, `aws-iam-authenticator`, or a cloud CLI helper, that executable must be available on `PATH` inside the container. This image does not bundle cloud-provider auth plugins. When the binary is missing, the affected cluster still shows up and displays a clear error such as ``Exec plugin `gke-gcloud-auth-plugin` not found on PATH``.

The runtime image runs as the unprivileged `astronomer` user and only needs write access to its config volume.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP listen port inside the container. |
| `ASTRONOMER_LITE_CONFIG_DIR` | `$HOME/.config/astronomer-lite` | Where managed kubeconfigs and display overrides are persisted. |
| `ASTRONOMER_LITE_PORT_FORWARD_TTL` | `60m` | Max lifetime of a port-forward session. Port-forwards bind to `127.0.0.1` inside the container. |
| `KUBECONFIG` | _(unset → `~/.kube/config`)_ | System kubeconfig path(s); colon-separated like kubectl. |

### Deployment notes

- **Browser support:** Chrome 111+, Safari 16.4+, or Firefox 128+ for the
  Tailwind 4 UI, matching [Tailwind's browser requirements](https://tailwindcss.com/docs/upgrade-guide#browser-requirements).
- **Serve the UI and API from the same origin, at the root path.** The frontend
  calls the API with root-absolute paths (`/api/...`) and opens WebSockets
  (logs / exec / attach / watch) against `window.location.host`. Putting the
  container behind a reverse proxy that serves it under a sub-path
  (e.g. `/astronomer/`) or splits the API onto a different host will break the
  live streams and API calls. Front it with a host-based route (or a path that
  is stripped before it reaches the container), not a retained path prefix.
- **Choose the authentication mode explicitly for shared deployments.** Default
  `single-user` mode uses host kubeconfigs without login and should stay local.
  `server` mode provides local accounts plus optional OIDC, gates every cluster
  API, and isolates each user’s imported credentials. See [server setup](docs/server-mode.md).
- **Version check:** `GET /api/version` returns the build-stamped version and
  the Kubernetes client User-Agent (`astronomer-lite/<version>`).

## Features

**Cluster management**
- Auto-load `~/.kube/config`; UI to add/remove additional kubeconfigs
- Per-context cluster entries with reachability status (reachable / degraded / unreachable)
- Clear errors when a cluster is unreachable or kubeconfig exec plugins (`gke-gcloud-auth-plugin`, `aws-iam-authenticator`, OIDC) aren't on `PATH`
- Display customization: pick a chip color and initials for each cluster

**Resources** (standard kinds plus generic CRD browser)
- Workloads: Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs, **JobSets**
- Storage: PVs, PVCs, StorageClasses, ConfigMaps, Secrets (masked by default, server-side reveal gated by RBAC)
- Networking: Services, Ingresses, Endpoints, EndpointSlices, NetworkPolicies
- Policy: PodDisruptionBudgets, **VerticalPodAutoscalers**, ResourceQuotas, LimitRanges, PriorityClasses, RuntimeClasses, MutatingWebhookConfigurations, ValidatingWebhookConfigurations
- Security (read-only): ServiceAccounts, Roles, ClusterRoles, RoleBindings, ClusterRoleBindings
- Cluster: Namespaces, Nodes, Events, CRDs
- Generic resource browser via discovery + dynamic client (covers any GVR/CRD)

**Interactive**
- Live log tail with multi-container selection
- `kubectl exec` terminal (xterm.js) — and a separate **Attach** mode for connecting to PID 1's stdin/stdout
- Port-forward UI with server-managed session lifecycle
- YAML view + edit (Monaco) with server-side dry-run preview and split/unified diff
- Pasted single- or multi-document YAML apply through the API Resources page, dry-run gated before apply, with conflict / force-apply flow
- Helm: trusted chart catalogs or archive upload, values editing, install/upgrade preview and confirmation, release detail/history, rollback and uninstall

**Visualization & ops**
- **Topology** page with React Flow swimlanes (Service / Deployment / StatefulSet / DaemonSet / ReplicaSet / Pod / ConfigMap / Secret / PVC) and owns/selects/mounts edges; auto-fits on namespace switch and refresh
- **Metrics** page with cluster CPU / memory gauges, sortable per-node and per-pod tables with inline utilization bars, and Prometheus range charts (cluster CPU, cluster memory, top-N pods) when Prometheus is detected on-cluster
- Cluster dashboard with workload health rollup and node conditions

**Projects and tables**
- Saved cross-cluster namespace scopes, YAML import/export, resource summaries, access checks and relationship maps
- Resource table saved views, column visibility/width/pinning, keyboard navigation and CSV export
- Extended topology for ingress/TLS, autoscaling, scheduled jobs, service accounts and referenced configuration

**UX**
- Single active cluster + top-bar context switcher
- Multi-select namespace filter, persisted per-cluster
- Command palette (`Cmd/Ctrl-K`) with quick navigation and cross-cluster search
- Activity dock surfacing recent actions, port-forwards, and applied manifests
- Sidebar favorites — pin frequently-used resource types per cluster
- Dark default + light toggle
- Per-row triple-dots action menu on pod rows (logs / exec / attach / port-forward / view details) — no drawer round-trip required for common actions

## Accounts and optional plugins

- Local accounts with optional TOTP MFA and recovery codes, admin/user roles, password changes/resets, account disable and session revocation.
- Optional OIDC with PKCE, refresh and group mapping, or trusted identity-aware proxy login; local login remains available.
- Server mode uses separate kubeconfigs and caches for each user. Application roles never grant Kubernetes permissions.
- Deferred, explicit opt-in only (`ASTRONOMER_LITE_PLUGINS_ENABLED=true`): external plugins with declared permissions, signed catalog install/update, per-user settings, a documented Headlamp compatibility profile, sandboxed frames and host confirmation for changes. See [plugin development](docs/plugins.md).
- Astronomer typography, semantic colors, light/dark themes, persisted density and sidebar preferences, with Astronomer Lite branding.

See the [Headlamp comparison](docs/headlamp-parity.md) for verified coverage and remaining gaps.

## Out of scope

The following are intentionally **not** part of `astronomer-lite`:

- Cluster agents and reverse tunnels
- ArgoCD integration / app-of-apps views
- Persistent app database (Postgres / SQLite / migrations)
- Bundled cloud-provider exec plugins (you provide them on `PATH`)
- HA/multiple replicas, shared database, auto-updates and package-manager repositories
- Full compatibility with every Headlamp SDK extension or catalog plugin

## Repository layout

```
astronomer-lite/
├── server/                 # Go (cmd/, internal/)
│   ├── cmd/astronomer-lite/
│   └── internal/
│       ├── cache/          # TTL cache + informer manager
│       ├── config/
│       ├── kubeconfig/     # Registry, probing, display overrides
│       ├── plugins/
│       └── server/         # REST + WS handlers, Helm, Prom, OpenAPI, topology
├── web/                    # Vite + React + TS
│   ├── src/
│   │   ├── components/     # layout, ui, clusters, metrics, palette, activity
│   │   ├── hooks/
│   │   ├── lib/            # api client, openapi, access checks, formatters
│   │   ├── pages/
│   │   ├── navigation/
│   │   └── styles/globals.css   # shared design tokens + .k8s-table classes
│   └── e2e/                # Playwright suite
├── deploy/docker/Dockerfile
├── docker-compose.yml
├── scripts/                # k3d-e2e runner
├── docs/
│   ├── plugins.md          # Deferred external plugin SDK and opt-in setup
│   └── specs/              # Source-of-truth specs + progress log
└── Makefile
```

## Development

```bash
# Prepare the isolated plugin runtime once:
make compat-build
# In two terminals
cd web && npm install && npm run dev       # Vite on :5173 (HMR), proxies /api → :8080
cd server && go run ./cmd/astronomer-lite  # Go API on :8080
```

Then open http://localhost:5173.

For a production build:

```bash
make build    # builds web/dist, embeds into Go binary
make image    # builds the container image
make image-size
```

For local verification without k3d:

```bash
make verify-local   # go test + go vet + npm lint + full build
```

Set `VERSION` when building release artifacts to stamp the Kubernetes API `User-Agent` as `astronomer-lite/<version>` and embed it in `/api/version`:

```bash
VERSION=0.1.0 make build image
```

Browser e2e tests live in `web/e2e` and are designed to run against a real k3d cluster in GitHub Actions. To run them manually, start `server/bin/astronomer-lite` with `KUBECONFIG` pointing at a reachable cluster, then run:

```bash
cd web
E2E_BASE_URL=http://127.0.0.1:8080 npm run e2e
```

On a Linux node with Docker, k3d, kubectl, Node, Go, and Python 3 installed, run the same real-cluster shape used by CI:

```bash
make k3d-e2e
```

That command creates a k3d cluster, adds a fake unreachable kubeconfig context for status coverage, starts `astronomer-lite` on port 18080, runs Playwright and the real-cluster account/RBAC checks, then cleans up. Set `K3D_AGENTS=0` for a single-node cluster and `KEEP_K3D_CLUSTER=1` to keep the cluster for debugging.

Useful k3d runner environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `K3D_CLUSTER_NAME` | `astronomer-lite` | Cluster name to create or reuse. |
| `K3D_AGENTS` | `1` | Agent count when creating a cluster; `0` creates a single-node cluster. |
| `REUSE_K3D_CLUSTER` | `0` | Set to `1` to reuse an existing cluster with the same name. |
| `KEEP_K3D_CLUSTER` | `0` | Set to `1` to leave the test cluster running after the suite. |
| `ASTRONOMER_LITE_E2E_PORT` | `18080` | Port used by the test server. |
| `KUBECONFIG_PATH` | `.kube/config` | Kubeconfig file generated for the test run. |
| `KEEP_E2E_CONFIG_DIR` | `0` | Set to `1` to keep the temporary app config directory for debugging. |

For the isolated local-account browser suite (no cluster required):

```bash
make build
cd web && npm run e2e:server
```

## Design system

Shared visual primitives live in `web/src/styles/globals.css` under `@layer components`. New tables should opt in via class names, not hand-copied Tailwind strings:

```html
<table class="k8s-table">
  <thead class="k8s-thead">
    <tr><th class="k8s-th">Name</th>…</tr>
  </thead>
  <tbody>
    <tr class="k8s-row table-row-hover">
      <td class="k8s-td-name">…</td>
      <td class="k8s-td-muted">…</td>
      <td class="k8s-td-numeric">…</td>
      <td class="k8s-td-actions">…</td>
    </tr>
  </tbody>
</table>
```

Changing the look of every resource list in the app is then a one-file edit.

## Implementation phases

1. **Walking skeleton** — Repo scaffolding, design-system port, kubeconfig loading, cluster list, dashboard, Pods page. _(done)_
2. **Live data + read pages** — WebSocket plumbing, watch on every list, logs, events, all read-only resource pages. _(done)_
3. **Write & interactive** — YAML edit, exec terminal, port-forward, metrics, secrets reveal. _(done)_
4. **Tier 2 / 3.1 features** — Helm, VPA, JobSet, webhook detail panels, topology, Prometheus range charts. _(done)_
5. **Simplify passes** — Three rounds of dedupe / efficiency / cohesion. _(done; latest in `simplify-pass-3` branch)_
6. **Plugin seam** — Internal pages share the navigation registry; documented in `docs/plugins.md`. _(external runtime now available; see `docs/plugins.md`)_

See [`docs/specs/...progress.txt`](docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui-progress.txt) for live progress and [`docs/verification.md`](docs/verification.md) for the current completion checklist.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for Astronomer UI provenance and third-party attribution.

Release metadata, signing, and native validation are described in [docs/releasing.md](docs/releasing.md).
