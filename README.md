# Astronomer-lite

A Headlamp-style, single-container Kubernetes UI. Add kubeconfigs, manage multiple remote clusters, get the full astronomer look in a small-footprint app.

> **Status:** Alpha — Tier 1–3.1 features are in place (cluster management, all standard workload/networking/storage/RBAC pages, Helm, VPA/JobSet, topology, metrics, exec/logs/port-forward, generic resource browser, YAML edit + apply with server-side dry-run). Three simplify passes have landed since the initial spec.
> **Spec:** [`docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui.md`](docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui.md)

## What it is

`astronomer-lite` is the lightweight cousin of [`astronomer`](../astronomer). Same visual language as the full astronomer, but architecturally minimal:

- **No agents.** No reverse tunnels. No central database. No multi-process coordination.
- **Direct kubeconfig-based access** to every cluster, just like Headlamp.
- **One container, one process.** `docker run` and you're done.

## Why

`astronomer-go`'s full architecture (server + agent + tunnel + worker + Postgres + RBAC + ArgoCD) is overkill when you just want to point a UI at a few clusters you already have kubeconfigs for. Headlamp solves that minimally but doesn't match our team's design language. `astronomer-lite` bridges the gap.

## Architecture

| Layer | Choice |
|---|---|
| Frontend | Vite + React SPA, reusing Tailwind tokens and layout patterns from [`../astronomer/frontend`](../astronomer/frontend) |
| Backend | Go + `client-go`, embeds Vite build via `embed.FS` |
| API style | Thin REST proxy `/api/clusters/{id}/...` → forwards to that cluster's API server (using its `rest.Config`) |
| Live data | One WebSocket per stream (watch / logs / exec / attach) |
| Storage | Flat files under `~/.config/astronomer-lite/` — no DB |
| Caching | Per-cluster informer factories, TTL caches for OpenAPI / discovery / Prometheus detection / Helm getters |
| Distribution | Container image (Docker / Podman) |

## Quickstart

### Docker Compose (recommended)

```bash
docker compose up -d
open http://localhost:8080
```

The compose file mounts `~/.kube` read-only and persists app-managed state to a named volume. Override the host port with `ASTRONOMER_LITE_PORT=18080 docker compose up -d`. Rebuild from your checkout with `docker compose build`.

### Plain `docker run`

```bash
docker run \
  -p 8080:8080 \
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
- Helm: releases list, release detail, history, rollback, uninstall — all via Helm SDK against the live cluster

**Visualization & ops**
- **Topology** page with React Flow swimlanes (Service / Deployment / StatefulSet / DaemonSet / ReplicaSet / Pod / ConfigMap / Secret / PVC) and owns/selects/mounts edges; auto-fits on namespace switch and refresh
- **Metrics** page with cluster CPU / memory gauges, sortable per-node and per-pod tables with inline utilization bars, and Prometheus range charts (cluster CPU, cluster memory, top-N pods) when Prometheus is detected on-cluster
- Cluster dashboard with workload health rollup and node conditions

**UX**
- Single active cluster + top-bar context switcher
- Multi-select namespace filter, persisted per-cluster
- Command palette (`Cmd/Ctrl-K`) with quick navigation and cross-cluster search
- Activity dock surfacing recent actions, port-forwards, and applied manifests
- Sidebar favorites — pin frequently-used resource types per cluster
- Dark default + light toggle
- Per-row triple-dots action menu on pod rows (logs / exec / attach / port-forward / view details) — no drawer round-trip required for common actions

## Out of scope

The following are intentionally **not** part of `astronomer-lite`:

- Multi-user auth, login screen, app-level RBAC (server mode is a future, separate spec)
- Agent / reverse tunnel / proxy connectivity
- ArgoCD integration / app-of-apps views
- Persistent app database (Postgres / SQLite / migrations)
- External plugin runtime (an architectural seam exists; the runtime loader doesn't)
- Bundled cloud-provider exec plugins (you provide them on `PATH`)
- Raw-binary / Helm chart / Homebrew / scoop / apt distribution

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
│   │   ├── plugins/
│   │   └── styles/globals.css   # shared design tokens + .k8s-table classes
│   └── e2e/                # Playwright suite
├── deploy/docker/Dockerfile
├── docker-compose.yml
├── scripts/                # k3d-e2e runner
├── docs/
│   ├── plugins.md          # Plugin registry interfaces (stub)
│   └── specs/              # Source-of-truth specs + progress log
└── Makefile
```

## Development

```bash
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

On a Linux node with Docker, k3d, kubectl, Node, and Go installed, run the same real-cluster shape used by CI:

```bash
make k3d-e2e
```

That command creates a k3d cluster, adds a fake unreachable kubeconfig context for status coverage, starts `astronomer-lite` on port 18080, runs Playwright, then cleans up. Set `KEEP_K3D_CLUSTER=1` to keep the cluster for debugging.

Useful k3d runner environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `K3D_CLUSTER_NAME` | `astronomer-lite` | Cluster name to create or reuse. |
| `REUSE_K3D_CLUSTER` | `0` | Set to `1` to reuse an existing cluster with the same name. |
| `KEEP_K3D_CLUSTER` | `0` | Set to `1` to leave the test cluster running after the suite. |
| `ASTRONOMER_LITE_E2E_PORT` | `18080` | Port used by the test server. |
| `KUBECONFIG_PATH` | `.kube/config` | Kubeconfig file generated for the test run. |
| `KEEP_E2E_CONFIG_DIR` | `0` | Set to `1` to keep the temporary app config directory for debugging. |

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
6. **Plugin seam** — Internal pages registered through the plugin registry; documented in `docs/plugins.md`. _(in-place; external plugin loader still out of scope)_

See [`docs/specs/...progress.txt`](docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui-progress.txt) for live progress and [`docs/verification.md`](docs/verification.md) for the current completion checklist.

## License

TBD.
