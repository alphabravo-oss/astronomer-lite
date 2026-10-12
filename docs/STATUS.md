# Astronomer-Lite — current status

Updated 2026-10-12. Release candidate 0.2.0-rc.1. External plugins are now deferred from the default release: preserved behind `ASTRONOMER_LITE_PLUGINS_ENABLED=true`, with their UI and APIs disabled by default. The requested parity implementation includes desktop packaging while retaining single-instance, file-backed operation. This document supersedes older MVP exclusions. See the [capability matrix](headlamp-parity.md) for precise boundaries; universal Headlamp plugin parity is not claimed.

## Implemented

- Core Kubernetes management: kubeconfig/direct-token connections, standard/dynamic resources, watches, logs/exec/attach, YAML dry-run/apply, delete/scale/rollback, node actions, secret reveal, metrics and Prometheus history.
- Helm catalog/archive install and upgrade with chart/version/values review, plus release history, rollback and uninstall.
- Cross-cluster namespace projects, import/export, access/resource summaries and relationship maps; expanded topology for jobs, ingress/TLS, HPA, service accounts and configuration references.
- Local accounts and TOTP MFA/recovery codes; OIDC PKCE, refresh and group roles; trusted identity-proxy login; per-user credentials/projects/plugin settings and live-session revocation.
- Explicitly approved credential helpers in shared mode. Arbitrary user-supplied exec remains prohibited there.
- Opt-in/deferred external plugins, brokered permissions, mutation review, signed catalog installation and reviewed updates. A scoped React/MUI Headlamp profile runs the upstream pod-counter example; see [compatibility](headlamp-plugins.md).
- Optional remote HTTPS browser-forward gateway with session-bound one-use links, isolated host cookies and HTTP/WebSocket proxying.
- Astronomer typography, colors, layout, theme and density; table saved views, column sizing/pinning/visibility, keyboard navigation and CSV; Lite branding retained.
- Electron desktop launcher, private local API and process locks. Linux AppImage/deb/RPM, Windows x64 NSIS and Intel/Apple Silicon Mac ZIPs built. RPM install/runtime/remove verified on Red Hat UBI 8/9/10; native Mac DMG and Windows installer/browser CI defined. Container/native server operation remains available.

## Verification and boundaries

[Verification](verification.md) records executed tests and measurements. The suite covers real single-node k3d clusters, local accounts/MFA, signed plugins, Dex login/refresh, server-mode Kubernetes RBAC/isolation and packaged Linux desktop behavior. Unit/race/lint/build checks complement browser coverage.

Shared deployment requires [server mode](server-mode.md) and HTTPS except on localhost. Application roles never grant Kubernetes privileges. Credentials and MFA secrets are file-backed and require protected storage/backups. Sessions and OIDC refresh tokens remain in memory. One process holds each workspace lock; HA/multiple replicas and a persistent database are intentionally excluded.

Only reviewed, trusted [plugins](plugins.md) should be installed. Iframe restrictions are defense in depth, not a malicious-code confidentiality guarantee. Browser confirmation is a UI safeguard, not a server approval token for authenticated direct API clients.

## Release work and product limits

- Apache-2.0 licensing and owned UI relicensing authorization are recorded. Signing, native workstation gates, versioned artifact manifests, and draft-release automation are implemented; see [release setup](releasing.md). Production signing/notarization is deferred by user decision; unsigned distribution is accepted for now. Registered desktop runners and successful native macOS/Windows/RHEL runs remain required before declaring native release readiness. No public release has been published.
- Production OIDC/proxy/cloud-helper configurations and public wildcard DNS/TLS forwarding need deployment-specific validation.
- Synthetic multi-context load on one physical cluster does not establish production fleet capacity. Longer representative tests are still needed.
- Headlamp compatibility intentionally exposes a documented SDK subset. Additional upstream plugins/global extension hooks need adaptation; not every observability integration is included.
- Pod drawer YAML remains read-only; use the generic browser to edit. Monaco may emit its internal unnamed-textarea console warning.

Agents, reverse tunnels, ArgoCD integration and shared-database/HA architecture remain outside Lite's scope.
