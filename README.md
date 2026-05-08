# astronomer-lite

A Headlamp-style, single-container Kubernetes UI. Add kubeconfigs, manage multiple remote clusters, and get the full astronomer look in a small-footprint app.

> **Status:** Pre-alpha. Spec complete; implementation underway.
> **Spec:** [`docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui.md`](docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui.md)

## What it is

`astronomer-lite` is the lightweight cousin of [`astronomer-go`](../astronomer-go). Same visual language as the full astronomer, but architecturally minimal:

- **No agents.** No reverse tunnels. No central database. No multi-process coordination.
- **Direct kubeconfig-based access** to every cluster, just like Headlamp.
- **One container, one process.** `docker run` and you're done.

## Why

`astronomer-go`'s full architecture (server + agent + tunnel + worker + Postgres + RBAC + ArgoCD) is overkill when you just want to point a UI at a few clusters you already have kubeconfigs for. Headlamp solves that minimally but doesn't match our team's design language. `astronomer-lite` bridges the gap.

## Architecture

| Layer | Choice |
|---|---|
| Frontend | Vite + React SPA, reusing Tailwind config + shadcn/Radix components from [`astronomer/frontend`](https://github.com/AlphaBravoCompany/astronomer) |
| Backend | Go + `client-go`, embeds Vite build via `embed.FS` |
| API style | Thin REST proxy `/api/clusters/{id}/k8s/*` → forwards to that cluster's API server (using its `rest.Config`) |
| Live data | One WebSocket per stream (watch / logs / exec) |
| Storage | Flat files under `~/.config/astronomer-lite/` — no DB |
| Distribution | Container image (Docker / Podman) |

## Quickstart

> Not yet released. The commands below are the target UX.

```bash
docker run \
  -p 8080:8080 \
  -v ~/.kube:/root/.kube:ro \
  ghcr.io/alphabravo-oss/astronomer-lite:latest
```

Open http://localhost:8080. Every context in your `~/.kube/config` shows up as a cluster. Add more via the UI (file upload or paste YAML).

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
- YAML view + edit (Monaco) with server-side dry-run preview
- Metrics charts from `metrics.k8s.io` (when metrics-server is installed)

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

> Not yet implemented. The commands below are the target dev workflow.

```bash
# In two terminals
cd web && npm install && npm run dev    # Vite on :5173 (HMR), proxies /api → :8080
cd server && go run ./cmd/astronomer-lite  # Go API on :8080
```

Then open http://localhost:5173.

For a production build:

```bash
make build    # builds web/dist, embeds into Go binary
make image    # builds the container image
```

## Implementation phases

1. **Walking skeleton** — Repo scaffolding, design-system port, kubeconfig loading, cluster list, dashboard, Pods page.
2. **Live data + read pages** — WebSocket plumbing, watch on every list, logs, events, all read-only resource pages.
3. **Write & interactive** — YAML edit, exec terminal, port-forward, metrics, secrets reveal.
4. **Plugin seam** — Internal pages registered through the plugin registry; documented in `docs/plugins.md`.

See [`docs/specs/...progress.txt`](docs/specs/i-want-to-make-a-headlamp-style-single-container--process-ui-progress.txt) for live progress.

## License

TBD.
