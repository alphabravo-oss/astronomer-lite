# astronomer-lite — Functionality, Wiring & Headlamp-Parity Audit + Fix Plan

**Author:** automated deep audit (Fable 5) — 2026-07-06
**Intended implementer:** Opus 4.8 (later session)
**Repo state at audit:** branch `main` @ `22b3d47`; `go test`, `go vet`, `npm run lint`, `npm test` (40 vitest) all green in a fresh container; `make web-build` + embedded-dist server boot verified.

---

## 0. How to read this document

This plan is deliberately verbose. Every finding carries: **what** the issue is, **evidence** (file:line or a reproduced command), **why it matters**, and a **task** with acceptance criteria. Tasks are grouped by priority tier and each has a stable ID (`P0-1`, `P1-3`, …) so the implementation session can check them off. Nothing here has been fixed yet — this is analysis + plan only.

The audit combined four techniques:
1. **Static wiring maps** — every backend route (`Routes()` + the `handleCluster` path-switch dispatcher) inventoried and cross-referenced against every `api.*` call in `web/src/lib/api.ts` and its call sites.
2. **Live smoke tests** — built the Go binary, booted it standalone (no cluster) and against a *fake unreachable* kubeconfig, and hit endpoints with `curl` to observe real responses. This is how the `addKubeconfig` bug (P0-1) was caught — it is invisible to static reading because the types "look" compatible.
3. **Test + docs audit** — enumerated all Go tests, the 40-case Playwright suite, and the vitest suite; extracted every spec acceptance criterion and every completion claim; diffed claims vs. reality.
4. **Headlamp comparison** — fetched current Headlamp docs/blog (SIG-UI project, 2025–2026) to frame parity.

---

## 1. Executive summary

astronomer-lite is in **substantially better shape than its own docs suggest**. The architecture (Go single binary embedding a Vite SPA, thin per-cluster REST/WS proxy, informer + TTL caches, no DB) is coherent and matches the spec. The backend API surface is complete: **44 frontend resource configs map cleanly onto 46 backend `resourceDefinitions`** (no GVR/version drift found), every one of the 47 `api.*` client functions has real call sites, and all WebSocket URLs are centralized. Standalone boot works; SPA embedding, deep-link fallback, and hashed-asset serving all verified live. The core cluster lifecycle (preview → add → probe → error-surface → remove) was **verified working end-to-end against a fake unreachable kubeconfig** — the real client sends raw YAML + `?context=` and the backend accepts it (200, cluster created, `unreachable` status with a clean dial error, `DELETE`→204).

> **Correction / methodology note (important for the implementer):** An earlier pass of this audit briefly flagged the Add-cluster flow as a P0 "broken contract." That was a **false positive** caused by the auditor sending a hand-constructed JSON body (`{kubeconfig, contexts}`) that the *real* frontend never sends. `api.addKubeconfig` (api.ts:411-420) actually sends **raw YAML body + repeated `?context=` query + `Content-Type: application/yaml`**, which matches the backend and works. The only residual, legitimate item from that area is backend **error-message hardening** (a malformed body currently yields a raw `json: cannot unmarshal…` instead of a clean 400) — tracked as **P3-12**, not a P0. This note is left in deliberately so the implementer trusts the *verified* claims and re-checks anything marked "decision" or "confirm."

The **one true correctness bug** found is small: **`/api/version` is documented in the README but returns 404** (the route doesn't exist — P0-1). Beyond that, the real issues are (a) **security-relevant RBAC gating asymmetries** on exec/attach and the raw `/k8s/*` proxy (P1 tier), and (b) **verification debt**: the spec's Definition of Done requires "e2e green against k3d in CI," and this has **never been observed green** — the e2e workflow is disabled and CI has zero cluster-backed coverage. Many DONE-marked features (Events, cordon/drain, secret-reveal UI, YAML apply-conflict flow, favorites persistence, port-forward idle-TTL, and the entire Add-cluster UI) have **no automated test at any layer**.

Against Headlamp, astronomer-lite achieves strong **resource-browsing + read/edit/exec/logs/port-forward/Helm** parity for a single-container tool, but is missing Headlamp's newer signature capabilities (Projects, AI assistant, OpenTelemetry observability, a real external plugin runtime, richer map/graph view, backend API caching for multi-cluster). Most of these are explicitly **out of scope** per the spec — the plan flags them as "parity gaps (informational)" rather than fixes.

### Severity counts
- **P0 (correctness / broken behavior):** 1
- **P1 (security, data-integrity, spec-compliance gaps that are reachable by users):** 7
- **P2 (missing tests for shipped features; verification debt):** 9
- **P3 (polish, docs drift, dead code, minor UX, backend error hardening):** 13
- **Parity gaps (informational, mostly out-of-scope):** 6

### What was verified working live (so the implementer doesn't re-investigate)
- Standalone boot with no cluster; `/api/healthz`, `/api/clusters` (empty), `/api/plugins/nav` (29 items).
- Kubeconfig **preview** (raw YAML → context list) and **add** (raw YAML + `?context=` → 200, cluster row with sha1 id).
- Unreachable-cluster handling: cluster persists with `status:"unreachable"` + a human dial error; `GET /pods` on it → **502 with a clear message** (not a hang or opaque 500).
- Cluster **display** PATCH validates input (rejected `#ff0000` with `unknown color "#ff0000"` — palette-name contract, see P3-13) and **DELETE** → 204.
- SPA embedding after `make web-build`: `/` and deep links both serve `index.html` (`<title>Astronomer-Lite</title>`); hashed asset → 200.
- `go test`, `go vet`, `npm run lint`, `npm test` (40 vitest) all green in a fresh container.

---

## 2. Architecture & wiring map (reference)

### 2.1 Backend routes (authoritative inventory)

Top-level mux (`server/internal/server/server.go` `Routes()`):
- `GET /api/healthz` — liveness (verified: `{"status":"ok"}`)
- `POST /api/clusters/preview` — preview kubeconfig contexts (verified working)
- `GET /api/clusters` — list clusters (verified: `[]` empty, and populated after add)
- `POST /api/clusters` — **add managed kubeconfig** (see P0-1: contract mismatch)
- `GET /api/plugins/nav` — static nav registry (verified returns 29 items) — **but frontend never consumes it** (P3-2)
- `ANY /` — SPA handler (verified: serves index.html, deep-link fallback → index, hashed assets 200)

Per-cluster dispatcher (`clusters.go` `handleCluster`, path-switch on `/api/clusters/{id}/...`): `DELETE /{id}`, `PATCH|PUT /{id}/display`, `PATCH|PUT /{id}/links`, `GET /{id}/workloads-overview`, `GET /{id}/topology`, `GET /{id}/prom/detect`, `GET /{id}/prom/query_range`, `GET /{id}/dashboard`, `POST /{id}/can-i`, `GET /{id}/pods`, `GET /{id}/namespaces`, `GET /{id}/secrets/{ns}/{name}/reveal/{key}`, `GET /{id}/events`, `GET /{id}/metrics`, `POST /{id}/nodes/{name}/drain`, `GET|POST /{id}/portforwards`, `DELETE /{id}/portforwards/{sid}`, `ANY /{id}/k8s/{path...}` (raw proxy), `WS /{id}/ws/{logs,exec,attach,watch}`, `GET /{id}/discovery`, `GET /{id}/openapi`, `GET /{id}/search`, `GET|DELETE /{id}/helm/releases[...]`, `POST /{id}/helm/.../rollback`, `POST /{id}/apply`, `GET|PATCH|DELETE /{id}/gvr[...]`, `GET|PATCH|DELETE|POST /{id}/resources/{resource}[...]` (incl. `/scale`, `/rollback`), `GET /{id}/pods/{ns}/{name}`.

**No dead HTTP handlers.** `(*Server).HasHelm` (helm.go:403) is unused (its own comment admits it) — minor dead code (P3-6).

### 2.2 Frontend → backend contract notes
- All 47 `api.*` functions have real call sites (no dead client code).
- Empty namespace encoded as literal `_` in path segments — a shared magic value (fragile but functional; P3-9 to document).
- All WS URLs derive from `window.location.host`/`.protocol` → **same-origin-only assumption**; a base-path or split-host reverse proxy breaks all streams and all `/api` calls (P1-7).
- `controllerrevisions` is requested by the frontend (`resource-detail.ts`) via `/resources/{resource}` but has **no `resourceConfigs` entry** — it exists in the backend map, so it works, but the asymmetry is worth noting (P3-10).

### 2.3 Resource-definition drift check (frontend `resources.ts` vs backend `resourceDefinitions`)
Cross-checked GVRs for the tricky ones — **they match**: HPA `autoscaling/v2`, VPA `autoscaling.k8s.io/v1`, JobSet `jobset.x-k8s.io/v1alpha2`, Gateway `v1`, ReferenceGrants `v1beta1`, BackendTLSPolicies `v1alpha3`, XBackendTrafficPolicies `gateway.networking.x-k8s.io/v1alpha1`, events `events.k8s.io/v1`. No version drift found. (Good — this was a prime suspect and is clean.)

---

## 3. P0 — Correctness (fix first)

### P0-1 — `/api/version` endpoint claimed in README but does not exist (returns 404)

**Evidence (reproduced live):** `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18099/api/version` → **404**. Grep of `server/` for `api/version` → no route registered in `Routes()`. README.md:180 states: *"…stamp the Kubernetes API `User-Agent` as `astronomer-lite/<version>` and embed it in `/api/version`."* The `version` package (`server/internal/version/version.go`) only feeds the client User-Agent (`UserAgent()`); nothing serves it over HTTP. It is used only by `kubeconfig/registry.go`.

**Why it matters:** (a) Documentation asserts a capability that doesn't exist — a correctness/trust issue and the only outright false claim found. (b) An `/api/version` endpoint is genuinely useful for support ("what version am I running?"), health dashboards, and future upgrade checks. Headlamp exposes version info; astronomer-lite currently surfaces none anywhere (no UI, no API).

**Task P0-1:**
1. Add `GET /api/version` to `Routes()` returning `{"version": version.Version, "userAgent": version.UserAgent()}` (JSON, no auth, no cluster context needed). Register it next to `/api/healthz`.
2. Add a Go unit test asserting 200 + the `version.Version` string (mirror the existing `version_test.go` / `handlers_test.go` style; no cluster needed).
3. Optional but recommended: surface it in the UI (topbar footer or an "About"/help affordance). Headlamp shows the version; this is a cheap parity + support win.
4. **Acceptance:** `curl /api/version` → 200 with the build-stamped version; the README claim becomes true. If you decide *not* to add it, instead **fix the README** to stop claiming it — do not leave the docs asserting a 404 route.

> The Add-cluster flow was investigated as a suspected P0 and **cleared** — it works. See the executive-summary correction note and P3-12 for the only residual (backend error-message hardening).

---

## 4. P1 — Security, data-integrity & reachable spec gaps

### P1-1 — exec / attach WebSockets are NOT RBAC-gated server-side

**Evidence:** `handlePodExecWS` (`exec.go`) and `handlePodAttachWS` (`exec.go`) perform **no `s.authorize()` SelfSubjectAccessReview** before opening the stream, unlike `handlePortForwards` POST (which gates on `create pods/portforward`) and `handleSecretReveal` (gates on `get secrets`). Backend audit confirms: exec/attach are the only *interactive cluster-mutating* paths with no server-side SSAR.

**Why it matters:** exec into a container is one of the most powerful actions in Kubernetes (arbitrary code execution in the pod). The app already establishes the pattern of pre-flighting mutations with `can-i`; exec/attach are the highest-impact omissions. RBAC is *ultimately* enforced by the API server on the exec subresource, so this is **defense-in-depth + correct UX** (fail fast with a clear "forbidden" instead of a half-open terminal), not a full auth bypass. Still, it is the most security-relevant inconsistency.

**Task P1-1:**
1. In `handlePodExecWS` / `handlePodAttachWS`, call `s.authorize(ctx, id, ResourceAttributes{Verb:"create", Resource:"pods", Subresource:"exec"/"attach", Namespace, Name})` before upgrading the connection. On denial, return HTTP 403 *before* the WS upgrade (so the client sees a clean status, not a socket that closes).
2. Mirror the frontend: `pages/pod-exec.tsx` should `api.canI(...)` and disable/annotate the exec/attach action when denied (the resource drawer already does this for scale/delete/apply).
3. **Acceptance:** Go handler test (fake clientset, denied SSAR → 403 before upgrade; allowed → proceeds). Extend the existing `handlers_test.go` pattern.

### P1-2 — Raw `/k8s/*` proxy forwards all mutating verbs with no server-side gating

**Evidence:** `handleKubernetesProxy` (`proxy.go`) is a transparent reverse proxy passing **all methods (GET/POST/PUT/PATCH/DELETE)** straight to the API server with no `authorize()` call. Backend audit flagged it.

**Why it matters:** This is intentional (the spec describes `/k8s/*` as the Headlamp-style passthrough, and RBAC is enforced upstream by the API server using the cluster credential). **But**: (a) the frontend audit found **no runtime consumer** of `/k8s/*` — it appears only in spec/progress docs, so it's currently an *unused* but *open* mutating surface; (b) an ungated passthrough that nothing uses is pure attack surface.

**Task P1-2 (decision required — flag for user):**
- **Option A (recommended):** If nothing uses `/k8s/*`, gate it behind the same `authorize()` preflight for mutating verbs, OR restrict it to read verbs, OR remove it entirely until a consumer exists.
- **Option B:** Keep as-is (documented Headlamp-parity escape hatch) but add an integration note and ensure it's covered by the "secrets never logged" guarantee (verify `logRequests` doesn't log `/k8s/*` bodies).
- **Acceptance:** an explicit, documented decision + a test asserting the chosen behavior. Do not silently leave an unused ungated mutating proxy.

### P1-3 — port-forward idle-TTL and cluster-switch auto-stop are unverified (US-14 acceptance)

**Evidence:** Spec US-14 requires port-forwards to **auto-stop after 60min idle and on cluster switch**. The TTL exists (`ASTRONOMER_LITE_PORT_FORWARD_TTL`, `startPortForward` sets an expiry timer). Frontend audit shows `App.tsx:82` and topbar call `stopPortForward`. But the test audit found **no automated test** proving either the idle-TTL expiry or the cluster-switch teardown; docs mark it "manual smoke only."

**Why it matters:** Port-forwards bind real local sockets and hold cluster connections; a leak (forward that outlives its cluster context) is a resource + security issue. This is a spec acceptance criterion with zero automated proof.

**Task P1-3:**
1. Go test: start a forward with a tiny TTL (e.g. `PortForwardTTL=100ms` via config injection), assert the session is removed from `s.portForwards` after expiry and the local listener is closed.
2. e2e or unit: assert that switching active cluster (or removing a cluster) stops that cluster's forwards.
3. **Acceptance:** both behaviors covered; the "manual only" caveat in docs removed.

### P1-4 — Events feature (US-11) claimed DONE with zero coverage

**Evidence:** `GET /{id}/events` exists (`events.go`), `pages/events.tsx` consumes it, and it's marked `[DONE]`. Test audit: **no e2e, no unit** for Events (page render, newest-first ordering, ns/type/kind filters, or the object-scoped Events tab in drawers).

**Why it matters:** Events are a primary troubleshooting surface. "DONE" with no test is exactly where regressions hide (and the frontend does non-trivial multi-namespace merging).

**Task P1-4:** Add an e2e that creates a resource generating an Event (e.g. a failing pod), opens `/events`, asserts it appears newest-first and that ns/kind filters work; plus a unit test for `eventRowFromObject` / the merge+sort logic if extractable. **Acceptance:** Events has coverage at ≥1 layer.

### P1-5 — YAML apply conflict / force / dry-run-diff flow untested; `isApplyConflictError` 409 branch uncovered

**Evidence:** The resource drawer implements a rich SSA flow: dry-run → diff → apply, with 409-conflict detection and force-apply (`applyResource`/`applyGVRResource` with `?force=`). Test audit: only the *happy* multi-doc apply is e2e-tested (`/apply` dry-run then apply). The **conflict/force path** and `isApplyConflictError`'s HTTP-409 branch have **no test** (only the string-matching delegate `isApplyConflictMessage` is unit-tested).

**Why it matters:** Server-side-apply conflicts are the trickiest, highest-stakes editing path (wrong handling = clobbering another controller's fields). This is US-12 core behavior.

**Task P1-5:**
1. Unit-test `isApplyConflictError` for the `ApiError` 409 branch (not just the message branch).
2. e2e: create a resource, mutate a field owned by another field-manager to force a 409 on apply, assert the UI surfaces the conflict and that force-apply resolves it.
3. **Acceptance:** conflict + force path covered.

### P1-6 — Node cordon/uncordon/drain end-to-end untested

**Evidence:** Drain skip-logic is unit-tested (`nodeDrainSkipReason`, `podUsesEmptyDir` — good). But the **actual cordon/uncordon patch** (`setNodeUnschedulable` → `applyResource` patching `spec.unschedulable`) and the **drain eviction flow** (`handleNodeDrain`) have no handler or e2e test.

**Why it matters:** Draining a node evicts workloads — a destructive, production-affecting action. The gating is RBAC-checked (good), but the mechanics are unverified.

**Task P1-6:** Go handler test for `handleNodeDrain` with a fake clientset (cordon applied, eligible pods evicted, skip-reasons honored, RBAC denial → 403). Optionally an e2e cordon/uncordon on the k3d node. **Acceptance:** drain/cordon covered at handler layer.

### P1-7 — Same-origin / no-base-path deployment assumption is undocumented and untested

**Evidence:** Frontend audit: all `/api` paths are root-absolute and all WS URLs use `window.location.host`. Deploying behind a reverse proxy that (a) serves the SPA under a sub-path, or (b) splits the API onto another host, **breaks every stream and every API call**. No configurable base URL exists.

**Why it matters:** This is a real deployment footgun for anyone putting the container behind an ingress with a path prefix. It may be acceptable for the "single container, direct access" design — but it must be *documented*, and ideally made configurable.

**Task P1-7 (decision):** Either (A) document the same-origin/root-path requirement prominently in README + fail loudly if a base path is detected, or (B) add a build/runtime base-path config (`import.meta.env.BASE_URL` wiring + a configurable API base). **Acceptance:** documented constraint at minimum; no silent breakage.

---

## 5. P2 — Verification debt (shipped features lacking tests)

The spec's Definition of Done requires **"e2e suite green against k3d in CI."** This has **never been observed green** (progress.txt + verification.md both mark it PARTIAL/PENDING; the e2e workflow lives in `.github/workflows-disabled/`). This is the single largest quality gap.

### P2-1 — Re-enable k3d e2e in CI (gated) and get it green
**Task:** Move `.github/workflows-disabled/e2e.yml` back to `.github/workflows/`, triggered on `workflow_dispatch` + a PR label (heavy job; don't run on every push). Run it, fix whatever's red, and record the first green run. **Acceptance:** at least one green k3d e2e run recorded; DoD line satisfied or explicitly re-scoped. **This is the top P2 and unblocks marking the project's DoD complete.**

### P2-2 — Correct the test-count claim
Docs say "19 Chromium tests"; actual `k3d.spec.ts` has **40** `test()` cases. Update verification.md + progress.txt. (Trivial, but it's a factual error that undermines doc trust.)

### P2-3 — Add-cluster-dialog e2e (the entire onboarding UI is untested)
The flow works (verified live via curl), but **no e2e drives the actual dialog**: paste/upload → preview contexts → select → submit → cluster appears → remove. The e2e suite only uses pre-seeded clusters (`reachableCluster()`). Add a Playwright test that pastes a fake unreachable kubeconfig, submits, asserts the cluster row + "unreachable" badge, then removes it. This is the highest-value missing e2e because it covers US-4 and would catch any future contract regression in the add path.

### P2-4 — Secret-reveal **UI** e2e
Go handler is unit-tested; the drawer reveal/hide/copy-per-key behavior is not. Add an e2e.

### P2-5 — Favorites persistence across reload
e2e only asserts a pin appears in-session; localStorage persistence + reappear-on-revisit (spec 2.4) is unasserted. Add reload assertion.

### P2-6 — Exec/attach terminal **UI** e2e (not just raw WS)
Current e2e drives raw WebSockets via `page.evaluate`; the xterm React page, container picker, and resize are untested. Add a UI-level exec test.

### P2-7 — Uncovered `resource-detail.ts` helpers
7 exported functions have no test: `gatewayTargetRefRows`, `gatewayRouteRuleRows`, `gatewayMatchesSummary`, `loadRevisionHistory`, `podTemplateImages`, `workloadLabelSelector`, `isApplyConflictError`. Add unit tests (cheap; the harness exists).

### P2-8 — Prometheus range-chart **render** path (present case)
Only the absent/degraded path is e2e-tested. If Prometheus-present rendering is kept in scope, test it; otherwise note it as beyond-spec.

### P2-9 — Workload-overview live recompute
Endpoint + static tile are tested; the "recompute within 5s when a pod fails" acceptance (spec 2.3) is not. Add if feasible in k3d.

---

## 6. P3 — Polish, dead code, docs drift

- **P3-1 — Reconcile stale docs.** `FEATURES-051126.md` lists shipped features as unchecked backlog; README calls them done; spec §4 never mentions Topology/Helm/VPA/JobSet/weblinks/favorites/Prometheus (post-spec additions). Write one authoritative status doc and mark FEATURES superseded. Also: Prometheus expands beyond the spec's `metrics.k8s.io`-only scope — acknowledge it.
- **P3-2 — `/api/plugins/nav` is orphaned.** Backend serves it; frontend hardcodes `navPlugins()` and never fetches it. Either consume it (single source of truth) or document that it's a stub for external consumers. (US-17 seam.)
- **P3-3 — `resourceActionPlugins()` returns `[]` and is never called.** Dead extension point. Either wire row-action plugins through it or delete it + its type to reduce confusion.
- **P3-4 — `NavItemPlugin.disabled` path is dead** (no plugin sets it; sidebar + palette branches unreachable). Remove or exercise.
- **P3-5 — Pod-drawer YAML edit state is inert** (`editedYaml`/`editMode` wired but `YamlViewDialog` is `readOnly allowEdit={false}` with no apply handler). Either enable pod YAML editing or drop the dead state. Note: pods *can* be edited via the generic resource drawer, so this may be intentional read-only — document it.
- **P3-6 — Dead code:** `(*Server).HasHelm` (helm.go:403) unused; `StatusDot` component (`components/clusters/status-dot.tsx`) never imported. Remove.
- **P3-7 — Breadcrumb intermediate links dangle.** Deep routes (`/clusters/:id/pods/:ns/:name/logs`) generate crumbs pointing at non-routes → catch-all redirect to `/`. `routeLabels` also missing `attach`, `verticalpodautoscalers`, `jobsets`, `endpointslices`, `gatewayclasses`. Make intermediate crumbs non-links or point them at real targets; fill in labels.
- **P3-8 — Double Cmd/Ctrl+K binding.** Topbar search focus and command-palette toggle both bind Cmd/Ctrl+K. Pick one owner.
- **P3-9 — Document the `_` empty-namespace path sentinel** as a shared contract (frontend api.ts ↔ backend path parsing) so it can't silently desync.
- **P3-10 — `controllerrevisions` has no `resourceConfigs` entry** though it's requested via `/resources/{resource}`. Add a config entry or a comment explaining why it's backend-only.
- **P3-11 — Monaco textarea console warning** (missing id/name) noted in README known-issues — cosmetic, fix or drop the note.
- **P3-12 — Backend `POST /api/clusters` error hardening.** A malformed request body currently surfaces a raw `json: cannot unmarshal string into Go struct field Config.contexts of type v1.NamedContext` (reproduced by sending a JSON envelope instead of raw kubeconfig YAML). The *real* frontend never triggers this (it sends raw YAML), but any bad/hand-rolled client gets an opaque 500-style message. Wrap the kubeconfig parse so a parse failure returns **400 with a human message** ("could not parse kubeconfig YAML"). Also apply to `/preview`. Low effort, improves robustness and API ergonomics.
- **P3-13 — Cluster display color contract is name-only.** `PATCH /{id}/display` rejects hex colors (`{"error":"unknown color \"#ff0000\""}` reproduced live) — it expects a palette *name* (e.g. `blue`). The UI dialog uses a palette picker so this is fine in-app, but the constraint is undocumented and the error is terse. Document the allowed color names (see `components/clusters/cluster-chip-colors.ts`) and/or accept hex. Verify the UI picker only emits valid names.

---

## 7. Headlamp parity comparison (informational)

Framing: astronomer-lite deliberately targets a **narrower** surface than Headlamp ("lite," single-container, no DB, no agents). Comparison is for context, not a demand to reach parity.

### Where astronomer-lite is at/near parity
- **Resource browsing** (workloads, storage, networking, RBAC read, cluster, Gateway API, CRDs, generic GVR) — strong parity.
- **Live watch** on lists with reconnect — parity.
- **Logs / exec / attach / port-forward** — parity (exec/attach even offer a separate attach mode).
- **YAML view + SSA edit with dry-run diff** — parity, arguably cleaner (split/unified diff).
- **Helm** (list/detail/history/rollback/uninstall) — parity for read+lifecycle (no install/upgrade/repo browsing — Headlamp's app catalog is richer).
- **Metrics** (metrics-server gauges) + optional Prometheus range charts — parity-plus for a lite tool.
- **Command palette + global search** — parity (Headlamp's search is label-aware and can change namespace; astronomer-lite's is name/label fan-out).
- **Topology/map** (React Flow swimlanes) — basic parity; Headlamp's map is more mature (Gateway API relationships, symptom→object navigation).
- **Activities dock** (pinned logs/exec/yaml/port-forward) — directly mirrors Headlamp's 2025 "activities" model. Good.
- **Multi-cluster** via kubeconfig contexts + top-bar switcher — parity for the lite model.

### Parity gaps (mostly out-of-scope per spec — informational, NOT fix tasks unless user elevates)
- **PG-1 — Projects** (group namespaces across clusters into app/team views). Headlamp's flagship 2025 feature. Out of scope; note as a possible roadmap item.
- **PG-2 — AI assistant** (natural-language cluster Q&A). Headlamp shipped this Aug 2025. Out of scope; roadmap.
- **PG-3 — OpenTelemetry observability** (metrics/logs/traces) + **backend API caching for multi-cluster**. astronomer-lite has informer/TTL caches but not a full observability stack.
- **PG-4 — Real external plugin runtime.** astronomer-lite has an internal registry seam only (spec explicitly defers the loader). Headlamp has a mature plugin ecosystem (KEDA, Karpenter, Volcano, etc.).
- **PG-5 — Auth methods (OIDC/token login).** Headlamp supports in-cluster auth flows; astronomer-lite is explicitly single-user, kubeconfig-cred, no login (server mode is a future separate spec). Fine — but the same-origin/no-auth assumption (P1-7) should be documented.
- **PG-6 — Richer map/graph** (symptom→object navigation, more relationship types). astronomer-lite's topology is namespaced and static-fit.

**Recommendation:** Keep parity gaps as an explicit "Non-goals / possible roadmap" section in the authoritative status doc (P3-1). Do not scope-creep the lite tool into Headlamp; the value proposition is "astronomer look, minimal footprint."

---

## 8. Suggested implementation order for the Opus 4.8 session

1. **P2-1** (re-enable + get k3d e2e green) — **do this first.** It unblocks the spec DoD and is the safety net that would catch regressions from every other change. It will also likely surface latent breaks. Everything below is safer once this exists.
2. **P0-1** (`/api/version`) — trivial, closes the one true correctness/doc bug.
3. **P1-1** (exec/attach RBAC gating) + **P1-2** decision (raw `/k8s/*` proxy) — security; the highest-impact consistency fixes.
4. **P1-3 / P1-4 / P1-5 / P1-6** — coverage + verification for destructive/spec-critical paths (port-forward TTL, Events, apply-conflict, drain).
5. **P2-3** (add-cluster-dialog e2e) + **P2-4 / P2-5 / P2-6** — cover the untested user-facing flows.
6. **P1-7** decision (base-path/same-origin) + **P3-1** (authoritative status doc; reconcile all drift; record parity non-goals; fix the "19 tests" count P2-2).
7. **P2-7, P2-8, P2-9** — remaining unit/e2e test debt.
8. **P3** cleanup sweep (dead code P3-6, breadcrumbs P3-7, keybinding P3-8, sentinels P3-9/10, backend error hardening P3-12, display-color contract P3-13, Monaco warning P3-11).

### Global acceptance for "fully wired and tested and validated"
- `make verify-local` green **and** k3d e2e green in CI (P2-1) — the spec DoD line, currently never satisfied.
- The add-cluster onboarding UI has an e2e proving it end-to-end (P2-3). (The flow already works; this locks it in.)
- Every destructive/security path (exec, attach, drain, delete, apply-conflict, secret-reveal, port-forward TTL, helm rollback/uninstall) has ≥1 automated test and consistent RBAC gating (exec/attach currently ungated — P1-1).
- One authoritative, non-contradictory status/feature doc; every README claim is true (notably `/api/version` — P0-1).
- No dead extension points left ambiguous (either wired or removed — P3-2/3/4/6).

---

## 9. Appendix — commands used to validate (reproducible)

```bash
# Build + boot standalone (no cluster)
cd server && go build -o /tmp/al ./cmd/astronomer-lite
PORT=18099 ASTRONOMER_LITE_CONFIG_DIR=/tmp/cfg KUBECONFIG=/tmp/none /tmp/al &

curl -s localhost:18099/api/healthz          # {"status":"ok"}   OK
curl -s localhost:18099/api/clusters          # []                OK
curl -s -o/dev/null -w '%{http_code}' localhost:18099/api/version   # 404  ← P0-2
curl -s localhost:18099/api/plugins/nav       # 29 items          OK (but unused by UI, P3-2)

# Cluster lifecycle with a fake unreachable kubeconfig
curl -s -XPOST --data-binary @kc.yaml localhost:18099/api/clusters/preview   # OK, lists context
# The shape the REAL frontend sends (api.addKubeconfig) — WORKS:
curl -s -XPOST -H 'Content-Type: application/yaml' --data-binary @kc.yaml \
  'localhost:18099/api/clusters?context=fake-context'                 # → 200, cluster created
# A hand-constructed JSON envelope (NOT what the app sends) — fails with an opaque error → P3-12 hardening:
curl -s -XPOST -H 'Content-Type: application/json' \
  -d '{"kubeconfig":"...","contexts":["fake-context"]}' localhost:18099/api/clusters
  # → {"error":"json: cannot unmarshal string ... v1.NamedContext"}   (opaque; should be a clean 400 — P3-12)
curl -s -o/dev/null -w '%{http_code}' localhost:18099/api/clusters/<id>/pods  # 502 w/ clear dial error  OK
curl -s -XPATCH -H 'Content-Type: application/json' -d '{"color":"#ff0000"}' \
  localhost:18099/api/clusters/<id>/display   # → {"error":"unknown color \"#ff0000\""}  (name-only — P3-13)
curl -s -XDELETE -o/dev/null -w '%{http_code}' localhost:18099/api/clusters/<id>   # 204  OK

# SPA embedding (after `make web-build` + rebuild)
curl -s localhost:18099/ | grep -o '<title>[^<]*</title>'            # <title>Astronomer-Lite</title>  OK
curl -s localhost:18099/clusters/foo/deployments | grep title        # index.html (deep-link fallback)  OK

# Full local verification — all green at audit time
cd server && go test ./... && go vet ./...
cd web && npm run lint && npm test    # 40 vitest pass
```

**Note:** `api.addKubeconfig` (api.ts:411-420) was subsequently read and **confirmed** to send raw YAML + `?context=` with `Content-Type: application/yaml` — the working shape. So the add flow is correct; the only residual is backend error-message hardening for malformed bodies (P3-12). The "19 tests" figure in the docs is wrong — the suite has 40 `test()` cases (P2-2).
