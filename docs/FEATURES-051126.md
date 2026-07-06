# Feature Backlog — 2026-05-11

> **SUPERSEDED (historical planning snapshot).** Most Tier 1–3.1 items in this
> file have since shipped; the unchecked `[ ]` boxes below no longer reflect
> reality. For the current, authoritative state of what is built, verified, and
> out of scope, see [`docs/STATUS.md`](STATUS.md). This file is kept only for
> historical context.

Comparative feature audit against Freelens (`./freelens/`) and Headlamp
(`./headlamp/`). Each item below is something one or both of those projects
ship that Astronomer-Lite does not have yet but plausibly should. Items are
grouped by impact tier, each with sub-tasks and rough effort.

Conventions:

- **Effort:** XS (≤2h), S (≤1d), M (1–3d), L (3–7d).
- **Refs:** path inside this repo (`web/`, `server/`) or in the comparison
  trees (`freelens/`, `headlamp/`) so the next implementer can read the prior
  art before building.
- "Acceptance" is the minimum bar — sufficient for a PR to be merged.

Out of scope (already excluded by the product spec, do **not** add to this list
without changing the spec first): OIDC/OAuth login, external plugin runtime
loader, Electron desktop wrapper, system tray menu, multi-language i18n, OTEL
backend tracing, in-cluster `HeadlampConfig` CRD, multi-tenant RBAC, ArgoCD
integration, agent/reverse-tunnel connectivity.

---

## Tier 1 — Ship next

### 1.1 Helm release management
**Why:** The single biggest functional gap vs. Freelens and Headlamp. In real
clusters most "what's actually running" questions are answered via Helm, and
right now we can only see the rendered Deployments/ConfigMaps without any
release identity, version, or rollback path.

**Effort:** M

**Refs:** `headlamp/backend/pkg/helm/` (uses `helm.sh/helm/v3` SDK, action +
storage drivers); `freelens/packages/core/src/features/helm-releases/` (uses
the `helm` binary out-of-process).

**Tasks:**
- [ ] Add `helm.sh/helm/v3` to `server/go.mod`; pick the SDK route (no binary
      shelled-out, keeps the image small).
- [ ] New server file `server/internal/server/helm.go`:
  - [ ] `GET /api/clusters/{id}/helm/releases?namespace=…` — list releases
        (all namespaces when omitted). Fields: name, namespace, chart, version,
        appVersion, revision, status, updated.
  - [ ] `GET /api/clusters/{id}/helm/releases/{ns}/{name}` — full release:
        notes, values (merged + user), manifest YAML, chart metadata.
  - [ ] `GET /api/clusters/{id}/helm/releases/{ns}/{name}/history` — revision
        history.
  - [ ] `POST /api/clusters/{id}/helm/releases/{ns}/{name}/rollback`
        body `{revision: number}` (gated by `can-i patch deployments`).
  - [ ] `POST /api/clusters/{id}/helm/releases/{ns}/{name}/uninstall`.
- [ ] Wire actionable history into a new web page
      `web/src/pages/helm-releases.tsx` (and a per-release detail drawer
      reusing `yaml-editor` for values).
- [ ] Add a `Helm` sidebar group in `web/src/lib/resources.ts` /
      `web/src/components/layout/sidebar.tsx`; gate visibility on a Helm
      probe (`storage/release` ConfigMap/Secret existence) like we already do
      for Gateway API.
- [ ] Unit tests against a fakeclient with a seeded release ConfigMap.
- [ ] Playwright: install `bitnami/nginx` via `helm install` in setup, then
      verify list, detail, history, rollback round-trips through the UI.

**Acceptance:** Listing/viewing/rollback/uninstall all work end-to-end against
a k3d cluster with at least one real chart installed. Releases stored as
either Secrets or ConfigMaps (Helm 3 default + legacy) both show up.

**Scope cuts:** chart **install/upgrade** UI and chart-repo browsing are
explicitly deferred — they bring schema-aware form rendering and repo caches
that we don't need for the first cut. Reads + rollback + uninstall first.

---

### 1.2 Command palette (⌘K / Ctrl-K)
**Why:** Cheapest UX upgrade with the biggest "feels professional" payoff.
Lets keyboard users navigate the whole app without touching the sidebar.

**Effort:** S

**Refs:** `freelens/packages/core/src/features/command-pallet/` (search
strategy, action registry pattern).

**Tasks:**
- [ ] New `web/src/components/palette/command-palette.tsx`. Use the existing
      dependency tree — do **not** add a new combobox library, the YAML
      editor already bundles Monaco's command palette idiom we can mimic with
      a plain list + filter.
- [ ] Action registry in `web/src/lib/commands.ts`:
  - Switch to cluster X (per-cluster from `useClusters`).
  - Open page Y (each resource page; reuse `resourceConfigs`).
  - Apply YAML (opens the API Resources page in apply mode).
  - Toggle theme.
  - Open port-forwards.
  - Reload clusters.
- [ ] Global keyboard hook bound to `⌘K` / `Ctrl-K`. Esc closes.
- [ ] Mount in `web/src/components/layout/app-shell.tsx` so it works on any
      route.
- [ ] Playwright: open palette, type "pods", press Enter, assert URL.

**Acceptance:** Palette opens on `⌘K`, fuzzy-filters across all registered
commands, runs the selected action, closes. Works with arrow keys.

**Scope cuts:** no recent-search persistence, no plugin-contributed commands
(both can come later).

---

### 1.3 Global resource search
**Why:** "Find me the pod named *something*-*something* anywhere" is something
Headlamp does well and we currently force users to know the resource type
first. Pairs with the palette.

**Effort:** M

**Refs:** `headlamp/frontend/src/components/globalSearch/`,
`headlamp/frontend/src/components/advancedSearch/`.

**Tasks:**
- [ ] Server: `GET /api/clusters/{id}/search?q=<term>&kinds=<csv>` — performs
      fan-out list (capped at, say, 8 default kinds: pods, services,
      deployments, statefulsets, configmaps, secrets, ingresses, namespaces)
      with a shared `q` substring filter applied server-side after listing.
      Use the dynamic client + a worker pool; cap result count.
- [ ] Frontend: extend the command palette with a "Search resources" mode
      activated by `/` prefix, or a separate `?q=` page. Each hit renders as
      `kind • namespace • name` and clicking navigates to the resource detail
      drawer.
- [ ] Label-selector syntax support: `q=app=foo` should run a label list
      instead of substring scan.
- [ ] Cache last 50 successful queries in `localStorage` for the palette
      "recent" list.

**Acceptance:** Typing in the palette with a `/` prefix returns matching
resources across kinds within 1s on a small (<1k pod) cluster; clicking a
result navigates to the right detail page.

**Scope cuts:** no cross-cluster search; no full-text indexing.

---

### 1.4 OpenAPI inline field docs
**Why:** Today our Monaco YAML editor is a syntax-only view. Headlamp surfaces
the K8s OpenAPI schema descriptions inline so users learn while editing.

**Effort:** S

**Refs:** `headlamp/frontend/src/lib/docs.ts`.

**Tasks:**
- [ ] Server: `GET /api/clusters/{id}/openapi` — proxy the cluster's
      `/openapi/v2` document (gzipped, cached in memory for 10 min per
      cluster).
- [ ] Frontend helper `web/src/lib/openapi.ts` that, given a `kind` +
      `apiVersion` + JSON pointer, returns the field description.
- [ ] In the resource detail panel and the YAML editor's hover provider,
      enrich tooltips/hover-cards with the OpenAPI `description`.
- [ ] Graceful fallback if the cluster doesn't expose `/openapi/v2`.

**Acceptance:** Hovering on `spec.replicas` in a Deployment YAML shows the
Kubernetes description string. Works offline-once-fetched within a session.

---

### 1.5 Deployment / StatefulSet rollback button
**Why:** We already render Revision History in the workload drawer; the
rollback action is one button away. Headlamp ships this and it's a common
operator need.

**Effort:** XS–S

**Refs:** `headlamp/frontend/src/components/common/Resource/RollbackButton.tsx`.

**Tasks:**
- [ ] Server: `POST /api/clusters/{id}/workloads/{kind}/{ns}/{name}/rollback`
      body `{revision: number}` (kind ∈ deployments/statefulsets/daemonsets).
      Implement via `kubectl rollout undo` semantics: patch the deployment's
      `kubectl.kubernetes.io/restartedAt` and rewrite pod-template-spec from
      the chosen ReplicaSet revision.
- [ ] Gate with `can-i patch deployments`.
- [ ] Web: add a "Rollback to this revision" button to each row in the
      Revision History section.
- [ ] Confirm-dialog wraps the action.
- [ ] Playwright: scale-then-rollback, assert pod template returns.

**Acceptance:** Rolling back to a prior revision on a Deployment changes its
running pods to that revision's template within rollout-status time.

---

### 1.6 Pod logs download
**Why:** Trivial, oft-requested.

**Effort:** XS

**Refs:** `freelens/packages/core/src/features/pod-logs/` (download action).

**Tasks:**
- [ ] Add a "Download" button on the Pod Logs page that triggers
      `a[href].click()` over a Blob of the current buffer.
- [ ] Filename pattern: `{namespace}-{pod}-{container}-{timestamp}.log`.
- [ ] Respect the visible timestamp toggle; if timestamps are on, include
      them in the download too.

**Acceptance:** Click → file downloads with the visible log content.

---

## Tier 2 — Useful, more work

### 2.1 Activity dock (minimisable log/exec/yaml windows)
**Why:** Right now opening a log stream and then clicking another resource
kills the stream. Headlamp's activity panel keeps things alive in a
bottom-of-screen dock you can re-expand.

**Effort:** M

**Refs:** `headlamp/frontend/src/components/activity/Activity.tsx`.

**Tasks:**
- [ ] Global `ActivityContext` providing `open(activity)` /
      `minimize(id)` / `close(id)`. Activity kinds: `logs`, `exec`, `attach`,
      `yaml-edit`, `port-forward-watcher`.
- [ ] `web/src/components/activity/activity-dock.tsx` — bottom-of-viewport
      taskbar listing minimised activities; clicking restores into a floating
      pane.
- [ ] Floating pane component (draggable, resizable, z-stacking).
- [ ] Port the existing logs / exec / yaml-editor pages to be rendered both
      route-style (`/clusters/{id}/pods/{ns}/{name}/logs`) and dock-style.
- [ ] Persist open activities in `sessionStorage` so a refresh keeps them.

**Acceptance:** Open a log tail, click another resource, the log is still
streaming in the dock; click the dock entry to expand back.

**Scope cuts:** Don't reimplement Monaco/xterm inside the dock — pass the
existing components into the floating pane.

---

### 2.2 Resource topology graph
**Why:** Visual differentiator. Shows Deployment → ReplicaSet → Pod →
Service → Ingress edges, also volumes and configmaps. Useful for
debugging blast radius.

**Effort:** L

**Refs:** `headlamp/frontend/src/components/resourceMap/` — uses a force
layout with grouping.

**Tasks:**
- [ ] Pick a graph lib (`reactflow` is the obvious match for our stack;
      adds ~200KB gz, justifiable for this feature).
- [ ] Server: `GET /api/clusters/{id}/topology?namespace=…&root=<kind>/<name>`
      — return a JSON graph derived from ownerReferences plus
      selector→pod resolution for Services. Walk depth ≤ 3.
- [ ] Frontend `web/src/pages/topology.tsx` — graph view scoped to the
      selected namespace by default; click a node to open the existing
      detail drawer.
- [ ] Edge styling: solid (owns), dashed (selects), dotted (mounts).
- [ ] Group nodes by kind via Headlamp-style "swimlane" auto-grouping.
- [ ] Performance budget: chunked rendering for >300 nodes.

**Acceptance:** Topology view of a sample namespace renders a graph with
Deployments, RS, Pods, Services, ConfigMaps, Secrets, with hover-and-click
parity with the resource list pages.

**Scope cuts:** no graph editing, no save-layout, no per-user filters in v1.

---

### 2.3 Workload overview dashboard
**Why:** Per-cluster KPI cards exist but a "what's failing right now across
the cluster" rollup doesn't.

**Effort:** S–M

**Refs:** `freelens/packages/core/src/features/cluster/workloads/overview/`.

**Tasks:**
- [ ] Server: `GET /api/clusters/{id}/workloads/overview` — counts by status
      across Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs.
      Buckets: `healthy`, `degraded`, `failing`, `succeeded` (jobs).
- [ ] New page or new card on the existing dashboard: 4 stat tiles +
      a "top failing workloads" table linking to detail pages.
- [ ] Live-update through the existing watch infrastructure (one WS per
      kind, debounced count recomputation).

**Acceptance:** Killing a Pod (or scaling a Deployment to fail) reflects in
the dashboard within 5s without a refresh.

---

### 2.4 Favorites / pinned resources
**Why:** Pair with the per-cluster sidebar list we just shipped — let users
pin frequently-touched resources (a specific Deployment, a Namespace) so they
re-appear in a "Pinned" sidebar group on revisit.

**Effort:** S

**Refs:** `freelens/packages/core/src/features/favorites/`.

**Tasks:**
- [ ] Storage: `localStorage` key `astronomer-lite-favorites` keyed by
      cluster id → array of `{kind, namespace, name}`.
- [ ] Star icon in every resource row + every detail-drawer header.
- [ ] Sidebar group "Pinned" (only when non-empty, per-cluster).
- [ ] Drag-to-reorder (use `@dnd-kit/sortable` only if it's already in the
      tree — otherwise simple up/down arrows).

**Acceptance:** Pin a pod; navigate away; come back; the pinned pod is one
click away in the sidebar.

---

### 2.5 External weblinks per cluster
**Why:** Most teams pair a cluster with off-cluster tools (Grafana, ArgoCD,
runbook, status page). Freelens lets admins attach links.

**Effort:** S

**Refs:** `freelens/packages/core/src/features/weblinks/`.

**Tasks:**
- [ ] Server: extend the existing `cluster-display.json` schema to also hold
      a `links: [{label, url, icon?}]` array per cluster id.
- [ ] New PATCH route or extend `/api/clusters/{id}/display` with optional
      `links` field.
- [ ] UI in the existing Customize dialog: add/remove rows for links.
- [ ] Render links in the per-cluster sidebar header (collapsible "Links"
      submenu) and in the cluster card.

**Acceptance:** Add a Grafana link to a cluster, link appears in the sidebar
header for that cluster, click opens it in a new tab.

---

### 2.6 Prometheus multi-source auto-detect
**Why:** `metrics.k8s.io` only gives current point-in-time CPU/mem. If the
cluster has Prometheus, both Freelens and Headlamp tap it for historical
charts.

**Effort:** L

**Refs:** `freelens/packages/technical-features/prometheus/`.

**Tasks:**
- [ ] Detection probe at cluster load time: look for the standard service
      names (`prometheus-operated`, `prometheus-server`, `prometheus-k8s`)
      across common namespaces (`monitoring`, `prometheus`, `kube-system`,
      `openshift-monitoring`).
- [ ] Add a probe result to the `/api/clusters` response:
      `prometheus: {url, source}`.
- [ ] Server: `GET /api/clusters/{id}/prom/query_range?query=…&from=…&to=…`
      forwarding to the in-cluster Prometheus (via port-forward semantics or
      direct service URL through the API proxy).
- [ ] Frontend: replace the existing CPU/mem cards with Prom-backed range
      queries when available; fall back to metrics-server otherwise.
- [ ] Per-cluster setting to override the detected URL.

**Acceptance:** With kube-prometheus-stack installed on k3d, the Pod detail
page shows 1h CPU and memory range charts; without Prometheus, falls back to
current metrics-server values.

**Scope cuts:** no custom-query UI in v1, no per-user dashboards.

---

## Tier 3 — Niche but valuable

### 3.1 More resource detail pages
**Why:** Headlamp ships dedicated pages for several resources we currently
route through the generic GVR browser. Dedicated pages give better
summaries and field labels.

**Effort:** XS each, S total

**Refs:**
- `headlamp/frontend/src/components/verticalPodAutoscaler/`
- `headlamp/frontend/src/components/jobset/`
- `headlamp/frontend/src/components/runtimeClass/`
- `headlamp/frontend/src/components/endpointSlices/`
- `headlamp/frontend/src/components/webhookconfiguration/`

**Tasks:**
- [ ] `VerticalPodAutoscaler` (`autoscaling.k8s.io/v1`).
- [ ] `JobSet` (`jobset.x-k8s.io/v1alpha2`).
- [ ] `RuntimeClass` (`node.k8s.io/v1`).
- [ ] `EndpointSlice` (`discovery.k8s.io/v1`).
- [ ] `ValidatingWebhookConfiguration` and
      `MutatingWebhookConfiguration` (`admissionregistration.k8s.io/v1`) —
      these benefit *most* from a dedicated detail layout that renders the
      rule matchers as a table.
- [ ] For each, add to `web/src/lib/resources.ts` with an icon, group, and
      `apiGroup/version/resource` triple; same discovery-gated visibility
      pattern as Gateway API.
- [ ] If the generic detail panel is too thin, add a dedicated detail
      component (only for webhook configurations — the others render fine
      generically).

**Acceptance:** Each resource appears in the sidebar only when its CRD/GA
group is discovered on the cluster. Clicking shows a useful detail panel.

---

### 3.2 Projects (namespace grouping)
**Why:** Group N namespaces under a logical "project" with combined quota
views and a per-project topology graph. Headlamp uses it heavily.

**Effort:** M

**Refs:** `headlamp/frontend/src/components/project/`.

**Tasks:**
- [ ] Persistence: extend `cluster-display.json` (or split to
      `projects.json`) with `projects: [{id, name, namespaces[]}]` per
      cluster.
- [ ] CRUD UI under cluster settings.
- [ ] When a project is active (selectable in the namespace switcher),
      filter list views by `namespace in (...)`.
- [ ] Project-scoped quota + workload-overview rollups.

**Acceptance:** Defining a "platform" project containing 3 namespaces shows a
combined view on the dashboard and constrains the resource lists.

**Decide first:** does this duplicate or replace the existing multi-select
namespace filter? Don't ship both UIs for the same problem.

---

### 3.3 Hotbar (pinned clusters/resources toolbar)
**Why:** Persistent top-bar shortcuts for the few clusters/resources used
daily.

**Effort:** S

**Refs:** `freelens/packages/core/src/features/hotbar/`.

**Tasks:**
- [ ] Top-bar slot left of the cluster switcher with 8 configurable slots.
- [ ] Drag-and-drop or right-click "Add to hotbar" from any cluster card or
      resource row.
- [ ] Storage: `localStorage` key `astronomer-lite-hotbar`.

**Acceptance:** Pin two clusters; both appear as one-click swatches in the
top bar; click jumps directly to that cluster's dashboard.

**Decide first:** likely subsumed by Favorites (2.4) + the per-cluster
sidebar list. Only build if user-testing shows a real gap.

---

## Cross-cutting work (not features, but unblocks the above)

- [ ] **Watch-cache for read-mostly server endpoints** — the topology and
      workload-overview features both benefit from a server-side
      informer-backed cache so we're not re-listing on every request.
      `client-go/tools/cache`.
- [ ] **`can-i` enforcement audit** — anything that mutates state (rollback,
      uninstall, scale, drain) must be gated client-side on a `can-i` call
      and the server must double-check. Today rollback would be net-new
      attack surface; do this with #1.5 and #1.1.
- [ ] **Per-cluster server-side state directory** — Helm release detail
      caching, openapi schema caching, prom detection results all want a
      bounded in-memory cache. Add `server/internal/cache/` with TTL +
      cluster-scoped eviction (on cluster delete or kubeconfig reload).

---

## Notes from the audit (skip — already covered or explicitly out of scope)

- OIDC/OAuth login (Headlamp #7) — out per `README.md` "Out of scope".
- Plugin runtime loader (Headlamp #19, Freelens #12) — seam exists in
  `server/internal/plugins`; runtime loader explicitly out of scope.
- Electron desktop app (Headlamp #20) — single-container is the chosen
  distribution shape.
- Tray menu (Freelens #13) — requires desktop wrapper.
- Multi-language i18n (Headlamp #14) — defer until there's user demand.
- OTEL backend tracing (Headlamp #15) — overkill for a single-container
  process.
- Stateless server mode / `HeadlampConfig` CRD / dynamic-cluster CLI flag
  (Headlamp #16–18) — only meaningful for multi-tenant in-cluster
  deployments.
