# Headlamp comparison and Astronomer alignment

Updated 2026-10-12. This document records implemented capabilities, their tested boundaries and remaining release checks. The agreed deployment scope includes desktop packaging and **single-instance operation**. HA, multiple replicas and a shared database are excluded by decision, not unfinished backlog.

## Capability matrix

| Area | Implemented | Boundary / remaining validation |
|---|---|---|
| Multi-cluster resources | Kubeconfig and direct token/CA connection, reachability, standard resources, Gateway API version discovery, generic CRDs, watches and namespaces | Two k3d versions and a bounded synthetic load test; no production fleet certification |
| Operations | Logs, exec, attach, dry-run/apply/diff, delete, scale, rollback, node actions, RBAC-gated secret reveal | Cloud-provider-specific credentials/admission behavior require environment testing |
| Search/projects | Exact-object search/favorites links; saved cross-cluster namespace projects with YAML import/export, overview/resources/access/map | Project scopes use the current user's imported cluster IDs; graphs show a bounded subset |
| Topology | Workload ownership, services, storage/configuration references, CronJobs/Jobs, ingress/TLS, HPA targets, service accounts and env/projected references | Permission/truncation warnings; no secret contents are fetched for reference graphs |
| Metrics | metrics-server gauges/tables and optional Prometheus history | Not every upstream observability plugin is supported |
| Helm | Trusted repository catalog or archive upload; version/values selection; install/upgrade preview and confirmation; history/rollback/uninstall | Packaged dependencies required; preview is not full admission validation or readiness wait |
| Local identity | Local accounts, TOTP MFA, one-use recovery codes, admin/user roles, revocation | No public signup/email recovery; MFA key entry is manual |
| SSO/proxy identity | OIDC PKCE, verified refresh, required/admin group mapping; explicit trusted identity proxy integration | Real Dex 2.43.0 verified; production IdP/proxy configuration still needs validation; no provider logout |
| Cluster authentication | Inline credentials and approved operator-defined per-user/server credential helpers in shared mode; ordinary exec in trusted local mode | No bundled cloud CLI; actual AWS/Azure/GCP credentials not available for testing |
| Plugins (deferred; disabled by default) | Opt-in Lite SDK, permission broker, opaque frames, private settings, signed Ed25519 catalog/packages, reviewed updates disabled until reenabled | Trusted publishers only; no unattended updates/backend executables |
| Headlamp plugins (deferred) | `headlamp-v1` React/MUI compatibility profile; upstream pod-counter built unmodified and browser-tested | **Scoped SDK support**, not universal Headlamp catalog compatibility; see [profile](headlamp-plugins.md) |
| Remote forwards | Session-owned loopback forwards plus optional HTTPS browser gateway with one-use links and WebSocket support | Separate registrable wildcard domain required; public DNS/TLS deployment not exercised |
| Desktop | Electron launcher, private loopback API, single-instance/workspace locks, native packaging and CI definitions | Linux AppImage/deb/RPM, Windows NSIS and both Mac DMG/ZIP packages; hosted Mac/Windows execution and UBI 8/9/10 runtime checks passed for RC.2 and repeat for each candidate. Windows 11, RHEL workstation/SELinux and signing remain outstanding |
| Deployment | One container or desktop workspace, file state, no database, lock against duplicate process | HA/multiple replicas intentionally excluded |

Headlamp's official documentation covers [authentication](https://headlamp.dev/docs/latest/installation/), [OIDC](https://headlamp.dev/docs/latest/installation/in-cluster/oidc/), [identity-aware proxies](https://headlamp.dev/docs/latest/installation/in-cluster/identity-aware-proxy/), and [projects](https://headlamp.dev/docs/latest/learn/projects/). Its [basic-auth guidance](https://headlamp.dev/docs/latest/installation/in-cluster/basic-auth/) explains that it does not itself provide a local username/password user store. Lite's local accounts/MFA add capability; they do not establish universal superiority over Headlamp.

## Astronomer visual reference

Reference: `../astronomer-all/astronomer/frontend` at `24124b6e874bd0470b2a5603ef992262d2028263`, inspected on 2026-10-12. The reference design-system, global stylesheet, shell width policy, page primitives, tables, forms, tabs, and corresponding cluster/resource/settings routes were reviewed. There were no changes to reference styles, UI primitives, or layout components between the previous `5d56e7ba` reference and this commit.

Lite adopts Inter/JetBrains Mono Variable typography, Tailwind 4.3.3, semantic colors, density, light/dark themes, table headers, shell/sidebar spacing, reduced motion and persisted preferences. Pods, resource lists and shared data tables now offer column visibility/width/pinning, saved views, keyboard navigation and CSV export. CSV is the loaded filtered result, not an unseen server-side inventory export. Common loading/empty/retry states are shared in the new flows; existing specialist pages retain their own states. Helm and project multi-field flows use routes, with dialogs for confirmation.

The Orbit mark, blue/violet palette, **Astronomer Lite** name and **by AlphaBravo** remain. Desktop/mobile screenshots and functional browser tests were inspected. This is visual-language alignment, not pixel-for-pixel identity with the full Astronomer product.

### Page and layout audit — 2026-10-12

The audit covers every default Lite route and its shared layout. `web/e2e/ui-layout.spec.ts` enumerates the resource registry instead of maintaining a separate, incomplete resource list. On the isolated single-node k3d fixture, the matrix visits 64 routes at 1920×1080 in dark mode and 390×844 in light mode, including populated project/Helm routes and pod/service tools. It asserts one visible page heading, no page/main horizontal overflow, no uncaught rendering errors, and records route screenshots. Specialist lists may scroll horizontally inside their table viewport.

| Surface | Reviewed routes and states |
| --- | --- |
| Shell | Expanded/collapsed sidebar, mobile navigation, breadcrumbs, cluster/namespace selectors, command search, favorites, theme/density, activity dock, resizable event panel |
| Workspace | Cluster inventory, connection preview, kubeconfig import, cluster appearance/links, empty inventory; project inventory/create/detail/edit and Overview/Resources/Map/Access views |
| Cluster | Dashboard, API discovery and nested resource lists, metrics with unavailable optional providers, events and detail tabs, topology and namespace errors |
| Workloads | Pods, Deployments, ReplicaSets, DaemonSets, StatefulSets, Jobs, CronJobs, JobSets; summaries, owned resources, container specifications, revision history |
| Network | Services, Endpoints, EndpointSlices, Ingresses, IngressClasses, NetworkPolicies; Gateways, GatewayClasses, HTTPRoutes, GRPCRoutes, ReferenceGrants, BackendTLSPolicies, XBackendTrafficPolicies |
| Storage/configuration | PersistentVolumes, PVCs, StorageClasses, ConfigMaps, Secrets including explicit reveal/hide |
| Cluster/policy/access | Nodes, Namespaces, HPAs, VPAs, PDBs, ServiceAccounts, Roles, RoleBindings, ClusterRoles, ClusterRoleBindings, ResourceQuotas, LimitRanges, Leases, PriorityClasses, RuntimeClasses, mutating/validating webhooks, CRDs |
| Resource tools | Summary/Events/YAML/JSON tabs, YAML creation and dry-run, read-only/edit dialogs, split/unified diff, delete/scale/rollback/drain controls, custom resource summaries, metadata and empty/error states |
| Pod/service tools | Logs and download/dock actions, exec, attach, pod and service port-forward pages, live/reconnecting/error states |
| Helm | Release inventory, detail/history, rollback/uninstall confirmation, chart install and upgrade forms, preview/values/manifest |
| Authentication/settings | Local login and invalid credentials at desktop/mobile widths, account administration, password changes, MFA enrollment/recovery, single-user settings |
| Recovery | Unknown-route page; failed lazy route retains the shell and offers recovery; shared loading/error/retry/empty-action states |
| Deferred plugins | Host extension/catalog/settings source reviewed; opt-in account/catalog tests retained. External plugin iframe contents are isolated and are not promised to match the host design system. Plugins remain disabled by default. |

Changes made during this audit:

- Exact matches for all 37 shared default, 30 dark, and four compact-density CSS tokens; Inter/JetBrains Mono typography and Lite branding retained. Semantic page/section type sizes, chart palette, terminal surfaces, and React Flow control colors are centralized.
- Dense collections, logs, terminals and topology use full available width. Reading pages use Astronomer's 1800px maximum. Shared headers wrap long API identifiers; embedded resource collections use an h2 rather than a second h1.
- Helm and Topology use the shared page scaffold. Helm uses the existing DataTable for search, sorting, pagination, keyboard navigation, column preferences and export. Detail/event/forward tables use global table styling and local horizontal scrolling.
- One Card component replaces 53 repeated padded surfaces and consumes the global density token. Existing specialized summary renderers and dynamic table/graph/chart dimensions remain intentional; computed inline dimensions are not duplicate CSS.
- Resource/pod/Helm drawers share Radix modal focus, Escape dismissal and focus restoration. Kubeconfig/appearance dialogs use the canonical dialog, with viewport bounds and scrollable content. Table options use a collision-aware popover. Project/resource/event tabs share ARIA linkage and arrow/Home/End keyboard handling; the event-panel resize handle is keyboard operable.
- Operational errors use shared accessible wrapping error states. Local sign-in has a visible h1 on mobile. Unknown routes and lazy-load failures have explicit recovery screens.
- Route implementations load on demand. The main JS file fell from 910.12 KB to approximately 454 KB before compression (270.38 KB to approximately 143 KB gzip). Monaco remains a large, lazy editor chunk; the deferred plugin compatibility bundle is also separate. The landing-page regression checks that heavyweight page/editor scripts are not fetched.
- Removed confirmed unused CSS/animation configuration, inert pod YAML edit state, and the unused editor save branch. No blanket claim of zero dead code or universal performance superiority is made.

The desktop adds a native Settings command under Astronomer Lite on macOS and File on Windows/Linux, with Command/Ctrl-comma. Display branding is now **Astronomer Lite**, including installer app names, title bars, sign-in and MFA enrollment. Existing profile storage and protocol/package identifiers stay compatible.

Validation results: 52 cluster/workflow regression tests passed against the single-node k3d fixture. All 10 layout/accessibility/recovery tests passed after correcting a stale test selector, including both 64-route matrices. Seven account/server browser tests, 48 frontend unit tests, six desktop unit tests, four release-tool tests, and the Go authentication tests passed. Type checking, frontend production build, and lint passed. The renamed Linux package passed two packaged-app browser checks at 900px and 1440px, exercising native Settings, branding, the compatible default profile path, private API access and single-instance shutdown. The RPM built successfully and its install paths were inspected. Native macOS/Windows execution and graphical RHEL validation remain outstanding.

Validation uses the repository's browser regression harness against an isolated real k3d cluster. The collaborative preview was available but could not reach the workspace server (its environment-port URL returned an unrelated error page); saved browser-test screenshots were inspected instead. This is not a live pixel-diff against a running Astronomer deployment, and it does not replace native macOS/Windows/RHEL workstation validation. Lite's navigation, projects, cluster cards and resource drawers retain product-specific information architecture.

### Collapsed-sidebar follow-up — 2026-10-12

A follow-up identified a gap missed in the original audit: Lite rendered every resource as a separate collapsed icon, while Astronomer uses one control per labeled group with a navigation flyout. Lite now follows that pattern, places the expand/collapse control in the header, retains documentation in the rail, and makes pinned resources and cluster switching available through the same shared flyout. Workspace Clusters/Projects remain direct links. Flyouts use the existing Radix popover, stay within the viewport, focus the first link, dismiss on Escape/outside click/navigation, and close when switching to mobile layout.

Three focused browser tests passed with deterministic API fixtures: dark/light cluster navigation, keyboard focus/restoration, active groups, persisted collapse, many-cluster scrolling, and the mobile transition. Two rebuilt Linux desktop tests passed, including explicit assertions for the document title and native window title (**Astronomer Lite**). Frontend type checking, build, lint, and screenshot inspection passed. The collaborative preview timed out; this evidence comes from repository regression tests. Published RC.2 installers still contain the older branding and sidebar; updated native Mac/Windows installers have not yet been built or tested for this follow-up.

### RC.3 release review — 2026-10-12

Native Settings now navigates through a narrowly exposed preload notification and
React Router, preserving the document and live workspace state. The packaged
Linux test confirms this and verifies RC.2 profile upgrades using the actual
published DEB. Short-window command search keeps its last result reachable.
Every HTML table uses the global table classes, including Helm revision history;
main inventory tables retain persistent width/visibility/pinning and saved views.
A full-suite run exposed mobile cluster-card overflow with long real context
names. The grid now uses an explicit bounded column, cards can shrink, action
rows wrap, and connection errors wrap instead of disappearing. A deterministic
long-name/error regression complements the route matrices.

## Completion and release checks

The implemented scope is recorded above. Plugins are deferred from the default release and retained only behind an explicit operator opt-in; full Headlamp plugin parity is not a 0.2.0 release requirement. Each candidate repeats hosted macOS/Windows installer execution and UBI runtime checks. Stable release readiness still requires Windows 11 and RHEL graphical-workstation checks; production IdP/cloud-helper, public forward-gateway setup, and representative fleet performance require deployment-specific validation. Production signing is deferred by the distribution decision. Additional Headlamp plugins may require extending the compatibility profile; global extension hooks and every upstream plugin are not claimed complete.

See [verification](verification.md), [desktop](desktop.md), [server mode](server-mode.md), and [plugins](plugins.md) for evidence and reproducible setup.
