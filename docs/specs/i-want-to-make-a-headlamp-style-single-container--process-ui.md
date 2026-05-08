# Astronomer-Lite — Specification

**Slug:** `i-want-to-make-a-headlamp-style-single-container--process-ui`
**Created:** 2026-05-08
**Owner:** mj@alphabravo.io
**Status:** Ready for implementation

---

## 1. Overview

Astronomer-Lite is a Headlamp-style, single-container Kubernetes UI. A user adds kubeconfigs and manages multiple remote clusters from one small-footprint app. Visually it matches astronomer-go (reusing the design language defined in `../astronomer/frontend`), but architecturally it is dramatically simpler — no agents, no reverse tunnels, no central database, no multi-process coordination, no multi-tenant auth model. Cluster access is direct from the running app to each cluster's API server, using kubeconfig credentials the user has already.

## 2. Problem Statement

`astronomer-go`'s full architecture (server + agent + tunnel + worker + Postgres + RBAC + ArgoCD integration) is overkill when a user just wants to point a UI at a few clusters they already have kubeconfigs for. Headlamp solves this minimally but doesn't match the team's UI design language. Astronomer-Lite bridges the gap: Headlamp's deployment simplicity plus astronomer's visual identity.

## 3. Architecture (locked in)

| Decision | Choice | Rationale |
|---|---|---|
| Deployment scope | **Local-first; server mode later** | MVP runs on a developer's machine via `docker run`. Single-user, no auth, reads `~/.kube/config`. Server mode (multi-user, OIDC, in-cluster) is a future spec, not in this one. |
| Frontend | **Vite + React SPA**, reusing Tailwind config + shadcn/Radix components from `../astronomer/frontend` | Lighter than Next.js; trivially embeddable in a Go binary. Visual fidelity preserved by lifting design tokens + UI primitives. |
| Backend | **Go + client-go**, embeds Vite build via `embed.FS` | Same language as `astronomer-go`. Single binary ~30-50MB. Native streaming (Watch/logs/exec). |
| Distribution | **Container image only** (`docker run` / `podman run`) | Per user direction. Raw-binary, Helm, and package-manager distros deferred. |
| Layout/chrome | **Lift `astronomer/frontend/src/components/layout/*` verbatim**, prune nav links | Highest visual fidelity; minimum porting effort. |
| Live data | **WebSocket per stream**; React Query for one-shots | One WS per log tail / exec / watch. Easy lifecycle, no custom multiplexing protocol. |
| API surface | **Thin REST proxy** `/api/clusters/{id}/k8s/*` → forwards to that cluster's API server using its `rest.Config` (handles exec auth, certs). WebSockets at `/api/clusters/{id}/ws/*` for streams. | Mirrors Headlamp's backend pattern. Naturally covers CRDs and dynamic resources. Smallest custom surface area. |
| Multi-cluster UX | **Single active cluster + top-bar context switcher** | Matches kubectl mental model and Headlamp default. |
| Namespace UX | **Multi-select dropdown in top bar**, persists per-cluster | Multi-select preferred over single. |
| Secrets handling | **Masked by default**, reveal-per-key button | Reduces accidental leaks in screen-shares. |
| Theme | **Dark default + light toggle** | Matches `astronomer/frontend` (next-themes pattern; we'll port to a small custom hook). |
| Repo layout | **Monorepo: `server/` (Go) + `web/` (Vite)** | Standard split. Build pipeline: `cd web && npm run build` → `cd server && go build` (Go embeds `web/dist` via `embed.FS`). |
| Dev workflow | **Two processes: `vite dev` (HMR) + `go run`**; vite proxies `/api` → :8080 | Standard SPA dev story. |
| Testing | **Go unit tests + e2e against k3d in CI** | Reuse the k3d pattern from `astronomer-go`. Real-cluster tests catch kubeconfig parsing, watch, exec bugs that mocks miss. |
| Default port | **8080** | Matches `astronomer-go`. |

## 4. Scope

### 4.1 In Scope (MVP)

**Cluster management**
- FR-1: On startup, parse `~/.kube/config` (path overridable via `KUBECONFIG` env). Each context becomes one cluster entry.
- FR-2: UI to **add a kubeconfig** (file upload OR paste YAML). New configs are stored in an app-managed file under `~/.config/astronomer-lite/clusters.yaml` (or per-file under `clusters.d/`). `~/.kube/config` is **never mutated**.
- FR-3: UI to **remove** a cluster the user added (only app-managed entries are removable; entries from `~/.kube/config` are read-only with a "managed externally" badge).
- FR-4: Cluster list shows reachability indicator (green = reachable, yellow = degraded, red = unreachable). Background reachability probe every 30s (`/version` GET).
- FR-5: Unreachable clusters remain in the list with red indicator; clicking in shows a banner with the actual error from the API server.

**Dashboard & resources** (per cluster)
- FR-6: Cluster dashboard: node count, pod count, namespace count, server version, conditions summary.
- FR-7: Workloads pages: Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs (list, detail, describe-equivalent panel, scale where applicable, delete).
- FR-8: Storage pages: PersistentVolumes, PersistentVolumeClaims, StorageClasses, ConfigMaps, Secrets.
- FR-9: Networking pages: Services, Ingresses, Endpoints, NetworkPolicies.
- FR-10: Security (read-only): ServiceAccounts, Roles, ClusterRoles, RoleBindings, ClusterRoleBindings.
- FR-11: Cluster pages: Namespaces, Nodes, Events (live, cluster-wide), CRDs.
- FR-12: Generic resource browser: pick a GVR via discovery; list/view/edit any resource via the dynamic client. This covers CRDs and anything not in dedicated pages.

**Interactive features**
- FR-13: Pod logs — live tail via WebSocket. Container picker. Tail-N + follow. Download.
- FR-14: Pod exec — xterm.js terminal via WebSocket using the SPDY/exec subprotocol. Container picker.
- FR-15: Port-forward UI — server manages the lifecycle, returns a `localhost:NNNN` URL the user can click. Forwards live until UI closes or a max-idle timer.
- FR-16: YAML view + edit — Monaco editor; `Apply` performs a server-side dry-run first and shows the diff before final apply.
- FR-17: Metrics — pull from `metrics.k8s.io` for per-pod and per-node CPU/memory; render with Recharts. Gracefully hide if metrics-server isn't installed (don't error).
- FR-18: Secrets — base64 values are masked (`••••••••`) by default; per-key "reveal" button decodes inline.

**Multi-cluster & filters**
- FR-19: Top-bar context switcher (single active cluster).
- FR-20: Top-bar multi-select namespace filter; persists per-cluster.

**Theme & layout**
- FR-21: Dark default theme; light toggle persisted to localStorage.
- FR-22: Layout components (sidebar, topbar, breadcrumbs) lifted from `astronomer/frontend/src/components/layout/*`.

**Plugin architecture stub** (Phase 4)
- FR-23: Internal pages are registered via a plugin-style registry (interfaces: `NavItemPlugin`, `ResourcePagePlugin`, `ResourceActionPlugin`). No external loader, no plugin runtime. Documented in `docs/plugins.md` so future work can add an external loader without restructuring.

**Auth to clusters**
- FR-24: Support kubeconfig exec plugins (aws-iam-authenticator, gke-gcloud-auth-plugin, oidc) by relying on `client-go`'s exec runner. If the plugin binary is not on PATH, surface a clear per-cluster error: "Exec plugin `gke-gcloud-auth-plugin` not found on PATH."

### 4.2 Out of Scope

- Multi-user / login / OIDC / per-user RBAC for the **app itself** (server mode is a separate, later spec)
- Agent / tunnel / reverse-proxy connectivity (all access is direct, kubeconfig-based)
- ArgoCD integration / Application views / app-of-apps (astronomer-go feature; not in Headlamp)
- Persistent app database (Postgres / SQLite / migrations / sqlc) — all state lives in flat files under `~/.config/astronomer-lite/`
- External plugin loader / sandboxing (only the architectural stub from FR-23 lands)
- Bundling cloud-provider exec plugins in the image
- Raw-binary distribution / Helm chart / Homebrew / scoop / apt
- Auto-opening the browser on launch
- Server-side telemetry / phone-home

## 5. User Stories

> Each story is sized to be completable in ONE focused coding session. Stories are grouped by phase. Acceptance criteria are concrete and testable.

### Phase 1 — Walking Skeleton

#### US-1: Repo skeleton + dev workflow
**As a** developer **I want** the monorepo and dev workflow set up **so that** I can run the app and iterate.
- [ ] `astronomer-lite/` contains `server/` (Go module) and `web/` (Vite + React + TS + Tailwind).
- [ ] `make dev` (or `npm run dev` + `go run`) starts vite on :5173 and Go on :8080; vite proxies `/api/*` → :8080.
- [ ] `make build` produces a single Go binary that serves the embedded SPA at `/`.
- [ ] `Dockerfile` produces a `<200MB` image; `docker run -p 8080:8080 -v ~/.kube:/root/.kube astronomer-lite` shows the SPA at http://localhost:8080.
- [ ] `go vet ./...` and `npm run lint` and `tsc --noEmit` all pass.

#### US-2: Lift design system
**As a** developer **I want** the astronomer/frontend design tokens and primitives available **so that** subsequent UI work matches the look.
- [ ] `web/tailwind.config.ts` mirrors `../astronomer/frontend/tailwind.config.ts` (colors, fonts, radii).
- [ ] `web/src/styles/globals.css` mirrors the source's CSS variables / dark theme tokens.
- [ ] `web/src/components/ui/*` ports the shadcn/Radix primitives actually used in MVP (button, dialog, dropdown-menu, input, select, table, tabs, tooltip, scroll-area, separator, badge, skeleton, switch, command).
- [ ] `web/src/components/layout/{sidebar,topbar,breadcrumbs}.tsx` ported from source, nav links updated for lite's routes.
- [ ] Side-by-side screenshot vs astronomer/frontend at the same route shows visual parity (spacing, type, color).

#### US-3: Kubeconfig loading + cluster list
**As a** user **I want** the app to detect my existing clusters **so that** I see them on first run.
- [ ] On boot, server parses `KUBECONFIG` env or `~/.kube/config`. Each context = one cluster entry, identified by a stable id (sha1 of `cluster.server + context.name`).
- [ ] `GET /api/clusters` returns `[{id, name, context, server, source: "system"|"managed", reachable, version, error?}]`.
- [ ] On boot, server probes `/version` for each cluster (timeout 3s); list returns reachability + version.
- [ ] SPA route `/` shows the cluster list with green/yellow/red indicators and version.
- [ ] Reachability re-probes every 30s in the background.
- [ ] Test (k3d): create a kubeconfig with a real k3d cluster + a fake unreachable one; both appear with correct status.

#### US-4: Add / remove kubeconfig via UI
**As a** user **I want** to add another kubeconfig **so that** I can manage more clusters without editing files.
- [ ] "Add kubeconfig" button opens a dialog with file upload + textarea (paste YAML).
- [ ] `POST /api/clusters` accepts YAML body, validates (must parse as a kubeconfig), writes to `~/.config/astronomer-lite/clusters.d/<sha1>.yaml`.
- [ ] App-managed entries show a "Remove" action. System entries (from `~/.kube/config`) show a "managed externally" badge and **no** remove action.
- [ ] `DELETE /api/clusters/{id}` removes the file under `clusters.d/`. Refusing to delete system entries returns 400.
- [ ] Reachability is probed immediately after add; cluster appears in list with status.

#### US-5: Cluster dashboard + Pods page
**As a** user **I want** to drill into a cluster and see its pods **so that** I confirm end-to-end works.
- [ ] Selecting a cluster sets active cluster (URL: `/clusters/{id}`).
- [ ] Dashboard at `/clusters/{id}` shows node count, pod count, namespace count, server version, condition badges.
- [ ] `/clusters/{id}/pods` shows a paginated, sortable, namespace-filtered table of pods (name, ns, status, restarts, age, node).
- [ ] Pod row → detail drawer with metadata, containers, conditions.
- [ ] Top-bar namespace multi-select filters the list; selection persists per-cluster in localStorage.
- [ ] Test (k3d): with a real cluster, pods page populates within 2s of navigation.

### Phase 2 — Live Data + Read Pages

#### US-6: WebSocket plumbing for watches
**As a** developer **I want** a generic WS-based watch endpoint **so that** every list page can stream updates.
- [ ] `GET /api/clusters/{id}/ws/watch?gvr=...&ns=...` upgrades to WebSocket, runs a Watch on that GVR, streams `{type: ADDED|MODIFIED|DELETED, object}` JSON frames.
- [ ] Backend handles reconnect with `resourceVersion`; client receives a `RESET` frame on relist.
- [ ] React hook `useWatch(gvr, ns)` exposes `(items, status)` with sane defaults.
- [ ] Pods page (US-5) is converted to use `useWatch` and updates without re-fetch.

#### US-7: All workload list pages
- [ ] Add Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs list + detail pages.
- [ ] Each uses `useWatch`. Each has scale (where applicable) and delete actions.
- [ ] Acceptance: in k3d, creating/deleting a Deployment via `kubectl` reflects in the UI within 1s without manual refresh.

#### US-8: Storage / Networking / Security / Cluster read pages
- [ ] PVs, PVCs, StorageClasses, ConfigMaps, Secrets pages (Secrets values redacted in lists).
- [ ] Services, Ingresses, Endpoints, NetworkPolicies pages.
- [ ] ServiceAccounts, Roles, ClusterRoles, RoleBindings, ClusterRoleBindings pages (read-only).
- [ ] Namespaces, Nodes, CRDs pages.
- [ ] Each: list (with `useWatch`) + detail drawer.

#### US-9: Generic resource browser
- [ ] Discovery API populates a GVR picker.
- [ ] Selecting a GVR lists items via dynamic client; detail drawer shows YAML.
- [ ] CRD instances accessible this way.

#### US-10: Pod logs (live tail)
- [ ] `/clusters/{id}/pods/{ns}/{name}/logs` shows live tail; container picker; tail-N input; follow toggle; download button.
- [ ] WS endpoint `/api/clusters/{id}/ws/logs?ns=&pod=&container=&tailLines=&follow=`.
- [ ] Reconnect handling on transient disconnect.

#### US-11: Cluster events stream
- [ ] `/clusters/{id}/events` shows live stream of `events.k8s.io` v1 Events, newest first.
- [ ] Filter by namespace, type (Normal/Warning), involvedObject kind.

### Phase 3 — Write & Heavy-Interactive

#### US-12: YAML view + edit (Monaco)
- [ ] Detail drawer "Edit" tab shows resource YAML in Monaco.
- [ ] "Apply" button: server runs SSA dry-run first, returns diff; UI shows diff; user confirms → real Apply.
- [ ] Validation errors from API server surfaced inline.

#### US-13: Pod exec terminal
- [ ] xterm.js terminal at `/clusters/{id}/pods/{ns}/{name}/exec` with container picker.
- [ ] WS endpoint `/api/clusters/{id}/ws/exec?ns=&pod=&container=&command=`. Bidirectional stdin/stdout/stderr; resize events.
- [ ] Acceptance: `ls /` and `top` (interactive) work in the terminal against a k3d cluster.

#### US-14: Port-forward
- [ ] On Pod or Service detail: "Forward port" → dialog picks remote port; server starts forward and returns `http://localhost:NNNN`.
- [ ] Forwards listed in a top-bar tray; click to copy URL or stop.
- [ ] Forward auto-stops after 60min idle (configurable) and on cluster switch.

#### US-15: Metrics from metrics-server
- [ ] Pod and Node detail pages show CPU/mem charts from `metrics.k8s.io`.
- [ ] Polled every 15s (cheap; metrics-server doesn't support Watch well).
- [ ] If metrics-server is missing, hide the chart and show "metrics-server not installed" inline note (no error).

#### US-16: Secrets reveal
- [ ] Secret detail: each key shows masked value with eye-icon button → decode and show.
- [ ] Reveal state is per-key, not persisted.

### Phase 4 — Plugin Architecture Stub

#### US-17: Plugin registry seam
- [ ] Internal pages are registered through a `PluginRegistry` (frontend) and a `Provider` interface (backend) — same shape an external plugin would use.
- [ ] `docs/plugins.md` documents the interfaces and how a future plugin would attach.
- [ ] No external loading; no `plugins/` runtime directory yet.
- [ ] Acceptance: removing one of our internal "plugins" from registration removes its nav entry and route, proving the seam is real.

## 6. Non-Functional Requirements

- NFR-1: Cold start (`docker run` → first byte at `/`) under 2s on a developer laptop.
- NFR-2: Container image under 200MB.
- NFR-3: First paint of cluster list under 500ms after `/api/clusters` resolves.
- NFR-4: Watch reconnect transparent to the user (UI shows brief "reconnecting" badge but no data wipe).
- NFR-5: No app state survives container restart **except** files under `~/.config/astronomer-lite/` (when mounted).
- NFR-6: Secrets values are never logged on the server, even at debug log level.
- NFR-7: All requests to the k8s API server include a `User-Agent: astronomer-lite/<version>`.

## 7. Technical Design

### 7.1 Repo layout

```
astronomer-lite/
├── server/
│   ├── cmd/astronomer-lite/main.go     # entrypoint
│   ├── internal/
│   │   ├── config/                      # env, ~/.config/astronomer-lite/ paths
│   │   ├── kubeconfig/                  # load, merge, watch ~/.kube/config + clusters.d/
│   │   ├── clusters/                    # registry, reachability probe, rest.Config cache
│   │   ├── handler/
│   │   │   ├── proxy.go                 # /api/clusters/{id}/k8s/*
│   │   │   ├── watch.go                 # WS watch
│   │   │   ├── logs.go                  # WS logs
│   │   │   ├── exec.go                  # WS exec (SPDY ↔ WS bridge)
│   │   │   ├── portforward.go
│   │   │   └── apply.go                 # SSA dry-run + apply
│   │   ├── server/                      # routes, middleware, embed.FS for SPA
│   │   └── plugins/                     # Provider interface (FR-23)
│   ├── go.mod
│   └── Dockerfile
├── web/
│   ├── src/
│   │   ├── components/{ui,layout,clusters,workloads,resources,...}/
│   │   ├── hooks/useWatch.ts useK8s.ts useWS.ts
│   │   ├── pages/                       # route components
│   │   ├── lib/                         # api client, theme, util
│   │   └── plugins/                     # PluginRegistry + internal "plugins"
│   ├── tailwind.config.ts
│   ├── package.json
│   └── vite.config.ts
├── docs/
│   ├── plugins.md
│   └── specs/                           # this file
├── deploy/docker/
└── Makefile
```

### 7.2 Backend key types (sketch)

```go
// internal/clusters/registry.go
type Cluster struct {
    ID         string             // sha1(server + context)
    Name       string             // context name
    Context    string
    Server     string
    Source     Source             // System | Managed
    RestConfig *rest.Config       // built lazily
    Reachable  ReachableState     // updated by probe
    Version    string
    LastError  string
}

type Registry interface {
    List(ctx context.Context) []Cluster
    Get(ctx context.Context, id string) (*Cluster, error)
    AddManaged(ctx context.Context, kubeconfigYAML []byte) (*Cluster, error)
    RemoveManaged(ctx context.Context, id string) error
    RestConfig(ctx context.Context, id string) (*rest.Config, error)
    Subscribe(ctx context.Context) <-chan Event   // for SPA list updates
}
```

### 7.3 API surface (REST)

```
GET    /api/clusters                                  # list
POST   /api/clusters                                  # add managed (YAML body)
DELETE /api/clusters/{id}                             # remove managed
GET    /api/clusters/{id}                             # one cluster + status
GET    /api/clusters/{id}/k8s/*                       # generic proxy → API server
POST   /api/clusters/{id}/k8s/*                       # ditto
PUT    /api/clusters/{id}/k8s/*                       # ditto
PATCH  /api/clusters/{id}/k8s/*                       # SSA / strategic merge / json
DELETE /api/clusters/{id}/k8s/*                       # ditto
POST   /api/clusters/{id}/apply?dryRun=server|none    # SSA wrapper (FR-16)
GET    /api/clusters/{id}/portforwards                # list active forwards
POST   /api/clusters/{id}/portforwards                # start
DELETE /api/clusters/{id}/portforwards/{fid}          # stop

# WebSockets
WS /api/clusters/{id}/ws/watch?gvr=&ns=&fieldSelector=
WS /api/clusters/{id}/ws/logs?ns=&pod=&container=&tailLines=&follow=
WS /api/clusters/{id}/ws/exec?ns=&pod=&container=&command=
```

### 7.4 Storage layout (host filesystem)

```
~/.config/astronomer-lite/
├── prefs.json                           # theme, last-active cluster, per-cluster ns prefs
└── clusters.d/
    ├── <sha1>.yaml                      # one kubeconfig file per added cluster
    └── ...
```

`~/.kube/config` is read-only from the app's perspective.

### 7.5 Integration points

- `client-go` for typed clients, dynamic client, discovery, REST config.
- `apimachinery` for unstructured, GVR/GVK, watch.
- `gorilla/websocket` (or `nhooyr.io/websocket`) for WS server.
- `chi` for HTTP routing (lighter than gorilla/mux; matches `astronomer-go`'s style if it uses chi — verify and align).
- Frontend: `@tanstack/react-query`, `zustand`, `react-router`, `@monaco-editor/react`, `@xterm/xterm`, `recharts`, `cmdk`, `lucide-react`, Radix primitives.

### 7.6 Edge cases

- kubeconfig missing entirely → empty cluster list + onboarding card "Add a kubeconfig".
- kubeconfig has exec auth but binary not on PATH → cluster appears with red status, error: `exec plugin "<name>" not found on PATH`.
- API server returns 401/403 → propagate to UI with the original message (don't translate).
- Watch loses connection → backend reconnects with last known `resourceVersion`; on `410 Gone`, sends `RESET` frame and re-lists.
- Two contexts in different files referring to the same `cluster.server` → still treated as separate entries (id derives from server + context name).
- User uploads malformed kubeconfig → `POST /api/clusters` returns 400 with parse error.
- metrics-server not installed → metrics charts hidden with inline note.

## 8. User Experience

### 8.1 First run flow

1. User runs `docker run -p 8080:8080 -v ~/.kube:/root/.kube astronomer-lite`.
2. Browser → http://localhost:8080.
3. Cluster list populated from `~/.kube/config`. Reachable clusters green; unreachable red.
4. User clicks a cluster → dashboard. Top-bar shows cluster + namespace filter.
5. Sidebar shows Workloads / Storage / Network / Security / Cluster.

### 8.2 Adding a cluster

1. Top-right "Add kubeconfig" → dialog.
2. User uploads file or pastes YAML; "Add" → server validates + writes to `clusters.d/`.
3. New cluster appears in list with reachability status.
4. Removable (badge: "managed").

### 8.3 Daily-use flows

- **Tail a pod**: Workloads → Pods → row → "Logs" → live stream.
- **Exec into a pod**: Workloads → Pods → row → "Exec" → terminal.
- **Edit a deployment**: Workloads → Deployments → row → "Edit" → Monaco → "Apply" (preview diff) → confirm.
- **Switch clusters**: Top-bar context switcher → click another cluster → URL updates, sidebar reflects new cluster.

## 9. Implementation Phases

### Phase 1 — Walking Skeleton
**Goal:** End-to-end demo: run container → see a real cluster's pods.
- Stories: US-1, US-2, US-3, US-4, US-5
- **Verification:**
  - `make build` produces a runnable binary.
  - `docker build .` produces an image under 200MB.
  - `go vet ./... && go test ./...` passes.
  - `npm run lint && tsc --noEmit` passes.
  - E2E (k3d): cluster list shows, dashboard shows pod count, pods page populates, namespace filter works.

### Phase 2 — Live Data + Read Pages
**Goal:** Every list page is live; full read coverage.
- Stories: US-6, US-7, US-8, US-9, US-10, US-11
- **Verification:**
  - E2E (k3d): create/delete a Deployment via kubectl → UI updates within 1s, no refresh.
  - Logs page tails a real pod, follows new lines.
  - Events page shows live cluster events.
  - Watch reconnects after a transient disconnect (kill-and-restart API server proxy).

### Phase 3 — Write & Heavy-Interactive
**Goal:** YAML edit, exec, port-forward, metrics, secrets reveal.
- Stories: US-12, US-13, US-14, US-15, US-16
- **Verification:**
  - YAML edit dry-run shows diff; apply mutates the resource.
  - Exec terminal runs `top` interactively.
  - Port-forward to a Service produces a working `localhost:NNNN`.
  - Metrics charts render against k3d + metrics-server; with metrics-server uninstalled, charts hide cleanly.
  - Secrets values masked by default; reveal works per-key.

### Phase 4 — Plugin Architecture Stub
**Goal:** Internal pages registered via a plugin-style seam, documented for future external loaders.
- Stories: US-17
- **Verification:**
  - `docs/plugins.md` documents the registration interfaces.
  - Disabling one internal "plugin" registration removes its nav entry and route.
  - Code review: pages all use the registry; nothing in the layout hardcodes routes.

## 10. Definition of Done

- [ ] All user stories' acceptance criteria pass.
- [ ] `go vet ./... && go test ./...` clean.
- [ ] `npm run lint && tsc --noEmit` clean.
- [ ] `make build` produces a binary; `docker build .` produces an image under 200MB.
- [ ] E2E suite green against k3d in CI.
- [ ] Side-by-side visual review vs `astronomer/frontend` shows parity for layout, colors, typography.
- [ ] README documents `docker run` quickstart + supported kubeconfig auth modes (incl. exec-plugin caveat).
- [ ] `docs/plugins.md` exists and explains the registry.

## 11. Open Questions / Future Work (NOT in MVP)

- Server mode (multi-user, OIDC, in-cluster deploy, Helm chart) — separate spec.
- External plugin runtime (load JS bundles from disk, sandboxing) — Phase 4 only stubs the seam.
- Raw-binary distribution / Homebrew / scoop / apt — defer until container experience is solid.
- Per-cluster theme overrides? (Not requested; flag if useful later.)
- Saved YAML diffs / change history — Headlamp doesn't have this; defer.

## 12. Implementation Notes

- Treat `astronomer/frontend` as a **read-only reference**. Lift code by copying, not by importing — the Vite app should have no runtime dependency on Next.js, next-themes, next-auth, or `next/*`. Replace `next-themes` with a minimal local theme hook; replace `next/link` with `react-router`'s `Link`; replace `next/image` with native `<img>` (or just remove if not needed).
- Treat `astronomer-go` as a **patterns reference**: copy its slog setup, graceful-shutdown loop, and chi route style. Do **not** import from it; this is a separate module.
- The container image should run as a non-root user, write only under `/tmp` and `/root/.config/astronomer-lite/` (volume-mountable).
- Use `golangci-lint` matching `astronomer-go`'s config.
