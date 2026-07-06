# astronomer-lite — Authoritative Status

_Last updated: 2026-07-06. This file is the single source of truth for "what is
built, what is verified, and what is intentionally out of scope." Where it
disagrees with older notes, this file wins. It supersedes the backlog framing in
`docs/FEATURES-051126.md` (that file is a historical planning snapshot)._

## Build & verification state

- `go build`, `go vet`, `go test ./...`, and `golangci-lint run ./...` — green.
- `npm run lint`, `tsc --noEmit`, `npm test` (vitest), `npm run build` — green.
- Fast CI (`.github/workflows/ci.yml`) runs server + web checks on every push/PR.
- k3d Playwright e2e (`.github/workflows/e2e.yml`) is **gated**: it runs on
  manual `workflow_dispatch` or when a PR carries the `e2e` label. The suite is
  45 tests (`k3d.spec.ts` 40 + `audit.spec.ts` 5). Getting a recorded green k3d
  run is the remaining Definition-of-Done gate (needs a runner with Docker/k3d).

## Shipped features (implemented + wired)

Cluster management (add/remove kubeconfig, per-context reachability, display
customization); all standard resource pages (workloads, storage, networking,
RBAC read, cluster, Gateway API, policy) plus a generic GVR/CRD browser; live
watch with reconnect; pod logs (tail/follow/container-picker/download); exec &
attach terminals (xterm) with an RBAC preflight; port-forward with a managed
session lifecycle; YAML view + server-side-apply edit with dry-run diff and
conflict/force handling; metrics (metrics-server) with optional Prometheus range
charts; secrets masked-by-default with per-key reveal (RBAC-gated); Helm
list/detail/history/rollback/uninstall; topology (React Flow); command palette +
global search; activity dock; favorites; dark/light theme; `GET /api/version`.

These are real and match the README. The spec's §4 FR list predates several of
them (Helm, topology, VPA/JobSet/webhook panels, weblinks, favorites,
Prometheus); they are accepted post-spec additions. **Prometheus range charts
intentionally go beyond the spec's `metrics.k8s.io`-only metrics scope (FR-17)**
— they are additive and degrade gracefully when Prometheus is absent.

## Security posture

- Mutating and sensitive read paths preflight a SelfSubjectAccessReview
  (`can-i`): apply, delete, scale, rollback, node drain, port-forward, secret
  reveal, Helm rollback/uninstall, and (as of the audit follow-up) exec/attach.
- The raw `/api/clusters/{id}/k8s/*` passthrough is **read-only** (GET/HEAD);
  mutating verbs return 405. Writes go through the typed, RBAC-preflighted
  handlers. RBAC is ultimately enforced upstream by the API server.
- Secrets are never logged (`logRequests` strips query/body; unit-tested).
- No app-level auth by design — see the README "Deployment notes."

## Plugin seam (FR-23 / US-17) — intentional stubs

The frontend registry (`web/src/plugins/registry.tsx`) declares `NavItemPlugin`,
`ResourcePagePlugin`, and `ResourceActionPlugin` as the documented extension
interfaces (see `docs/plugins.md`). These are deliberate seams for a future
external loader, not dead code:

- `resourceActionPlugins()` returns `[]` today (no row-action plugins shipped).
- `NavItemPlugin.disabled` is an optional affordance a future plugin may set.
- `GET /api/plugins/nav` serves the internal nav registry for **external/API
  consumers**; the in-app SPA renders navigation from the bundled `navPlugins()`
  directly. The two are expected to describe the same internal pages.

An external plugin *runtime* (loading, sandboxing, signatures) is explicitly out
of scope for this spec.

## Known minor issues

- Monaco (`@monaco-editor/react`) renders an internal `<textarea>` without an
  `id`/`name`, which browsers log as a form-field console warning. It is
  cosmetic and originates inside the library; no app-side fix.
- The Pods page shows Pod YAML read-only by design; editing a Pod is done via
  the generic resource drawer.

## Non-goals / possible roadmap (Headlamp parity gaps)

astronomer-lite deliberately targets a narrower surface than Headlamp
("lite," single-container, no DB, no agents). The following Headlamp
capabilities are **out of scope** here and listed only for context:

- **Projects** — grouping namespaces across clusters into app/team views.
- **AI assistant** — natural-language cluster Q&A.
- **OpenTelemetry observability** (metrics/logs/traces) and heavy backend API
  caching for large multi-cluster fleets.
- **External plugin runtime** — a real loader/ecosystem (KEDA, Karpenter, …).
- **Auth methods** (OIDC/token login) — a future separate "server mode" spec.
- **A richer relationship map** — symptom→object navigation, more edge types.

The value proposition remains: the astronomer visual language in a minimal,
single-container footprint.
