# Astronomer-lite

A Headlamp-style, single-container Kubernetes UI. Add kubeconfigs, manage multiple remote clusters, and get the full astronomer look in a small-footprint app.

> **Status:** Pre-alpha. Spec complete; implementation underway.
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
| API style | Thin REST proxy `/api/clusters/{id}/k8s/*` → forwards to that cluster's API server (using its `rest.Config`) |
| Live data | One WebSocket per stream (watch / logs / exec) |
| Storage | Flat files under `~/.config/astronomer-lite/` — no DB |
| Distribution | Container image (Docker / Podman) |

## Quickstart

```bash
docker run \
  -p 8080:8080 \
  -v ~/.kube:/home/astronomer/.kube:ro \
  -v astronomer-lite-config:/home/astronomer/.config/astronomer-lite \
  astronomer-lite:dev
```

Open http://localhost:8080. Every context in your `~/.kube/config` shows up as a cluster. Add more via the UI with file upload or pasted YAML; app-managed kubeconfigs are stored under `/home/astronomer/.config/astronomer-lite/clusters.d` in the mounted volume.

Build the local image first if needed:

```bash
make image
make image-size
```

If your kubeconfig uses an exec plugin such as `gke-gcloud-auth-plugin`, `aws-iam-authenticator`, or a cloud CLI helper, that executable must be available on `PATH` inside the container. This image does not bundle cloud-provider auth plugins. When the binary is missing, the affected cluster remains visible and shows a clear error such as ``Exec plugin `gke-gcloud-auth-plugin` not found on PATH``.

The runtime image runs as the unprivileged `astronomer` user and only needs write access to its config volume.

Port-forward sessions bind to `127.0.0.1` and expire after 60 minutes by default. Set `ASTRONOMER_LITE_PORT_FORWARD_TTL`, for example `ASTRONOMER_LITE_PORT_FORWARD_TTL=15m`, to change that max lifetime.

## Features (MVP)

**Cluster management**
- Auto-load `~/.kube/config`; UI to add/remove additional kubeconfigs
- Per-context cluster entries with reachability indicator
- Clear errors when a cluster is unreachable or kubeconfig exec plugins (gke-gcloud-auth-plugin, aws-iam-authenticator, oidc) aren't on PATH

**Resources**
- Workloads: Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs
- Storage: PVs, PVCs, StorageClasses, ConfigMaps, Secrets (masked by default)
- Networking: Services, Ingresses, Endpoints, NetworkPolicies
- Security (read-only): ServiceAccounts, Roles, ClusterRoles, RoleBindings, ClusterRoleBindings
- Cluster: Namespaces, Nodes, Events, CRDs
- Generic resource browser via discovery + dynamic client (covers any GVR/CRD)

**Interactive**
- Live log tail
- `kubectl exec` terminal (xterm.js)
- Port-forward UI (server-managed lifecycle)
- YAML view + edit (Monaco) with server-side dry-run preview and split/unified diff
- Pasted single- or multi-document YAML apply through the API Resources page, dry-run gated before apply
- Recharts CPU/memory charts and Pod/Node detail metric cards from `metrics.k8s.io`, refreshed every 15s when metrics-server is installed

**UX**
- Single active cluster + top-bar context switcher
- Multi-select namespace filter, persisted per-cluster
- Dark default + light toggle

## Out of scope

The following are intentionally **not** part of `astronomer-lite`:

- Multi-user auth, login screen, app-level RBAC (server mode is a future, separate spec)
- Agent / reverse tunnel / proxy connectivity
- ArgoCD integration / app-of-apps views
- Persistent app database (Postgres / SQLite / migrations)
- External plugin runtime (an architectural seam exists; the runtime loader doesn't)
- Bundled cloud-provider exec plugins (you provide them on PATH)
- Raw-binary / Helm / Homebrew / scoop / apt distribution

## Repository layout

```
astronomer-lite/
├── server/           # Go (cmd/, internal/)
├── web/              # Vite + React + TS
├── deploy/docker/
├── docs/
│   ├── plugins.md    # Plugin registry interfaces (stub)
│   └── specs/        # Source-of-truth specs
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
make verify-local
```

Set `VERSION` when building release artifacts to stamp the Kubernetes API `User-Agent` as `astronomer-lite/<version>`:

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

## Implementation phases

1. **Walking skeleton** — Repo scaffolding, design-system port, kubeconfig loading, cluster list, dashboard, Pods page.
2. **Live data + read pages** — WebSocket plumbing, watch on every list, logs, events, all read-only resource pages.
3. **Write & interactive** — YAML edit, exec terminal, port-forward, metrics, secrets reveal.
4. **Plugin seam** — Internal pages registered through the plugin registry; documented in `docs/plugins.md`.

See [`docs/specs/...progress.txt`](docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui-progress.txt) for live progress and [`docs/verification.md`](docs/verification.md) for the current completion checklist.

## License

TBD.
