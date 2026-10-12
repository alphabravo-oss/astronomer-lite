# Headlamp comparison and Astronomer alignment

Updated 2026-10-11. This document records implemented capabilities, their tested boundaries and remaining release checks. The agreed deployment scope includes desktop packaging and **single-instance operation**. HA, multiple replicas and a shared database are excluded by decision, not unfinished backlog.

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
| Desktop | Electron launcher, private loopback API, single-instance/workspace locks, native packaging and CI definitions | Linux AppImage/deb/RPM, Windows NSIS and both Mac ZIPs built; RPM runtime verified on UBI 8/9/10. Native Mac/Windows execution, RHEL workstation/SELinux and signing remain release checks |
| Deployment | One container or desktop workspace, file state, no database, lock against duplicate process | HA/multiple replicas intentionally excluded |

Headlamp's official documentation covers [authentication](https://headlamp.dev/docs/latest/installation/), [OIDC](https://headlamp.dev/docs/latest/installation/in-cluster/oidc/), [identity-aware proxies](https://headlamp.dev/docs/latest/installation/in-cluster/identity-aware-proxy/), and [projects](https://headlamp.dev/docs/latest/learn/projects/). Its [basic-auth guidance](https://headlamp.dev/docs/latest/installation/in-cluster/basic-auth/) explains that it does not itself provide a local username/password user store. Lite's local accounts/MFA add capability; they do not establish universal superiority over Headlamp.

## Astronomer visual reference

Reference: `../astronomer-all/astronomer/frontend` at `5d56e7ba`, branch `implement/032-technology-guide`. Both remotes were refreshed on 2026-10-11 and `git pull --ff-only origin main` reported already up to date. Published `origin/main` is `3b378ef1`; the development branch contains it and is 676 commits ahead. Unrelated release edits in the reference checkout were preserved. No frontend changes were found between the previous reference `381d33a0` and `5d56e7ba`; DDL references concern database migrations, not a separate frontend.

Lite adopts Inter/JetBrains Mono Variable typography, Tailwind 4.3.3, semantic colors, density, light/dark themes, table headers, shell/sidebar spacing, reduced motion and persisted preferences. Pods, resource lists and shared data tables now offer column visibility/width/pinning, saved views, keyboard navigation and CSV export. CSV is the loaded filtered result, not an unseen server-side inventory export. Common loading/empty/retry states are shared in the new flows; existing specialist pages retain their own states. Helm and project multi-field flows use routes, with dialogs for confirmation.

The Orbit mark, blue/violet palette, **Astronomer-Lite** name and **by AlphaBravo** remain. Desktop/mobile screenshots and functional browser tests were inspected. This is visual-language alignment, not pixel-for-pixel identity with the full Astronomer product.

## Completion and release checks

The implemented scope is recorded above. Plugins are deferred from the default release and retained only behind an explicit operator opt-in; full Headlamp plugin parity is not a 0.2.0 release requirement. The remaining work before broad distribution is environment/release validation: native macOS/Windows installer execution, RHEL graphical-workstation checks and signing, production IdP/cloud-helper and public forward-gateway setup, and longer representative fleet performance tests. Additional Headlamp plugins may require extending the compatibility profile; global extension hooks and every upstream plugin are not claimed complete.

See [verification](verification.md), [desktop](desktop.md), [server mode](server-mode.md), and [plugins](plugins.md) for evidence and reproducible setup.
