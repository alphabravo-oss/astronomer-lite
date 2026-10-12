# Verification record

Date: 2026-10-11. Scope: the [parity capability matrix](headlamp-parity.md), including desktop packaging and single-instance operation. Tests use isolated local state and disposable cluster resources, not production credentials.

## Release automation (2026-10-12)

The owned-code licensing decision is complete: AlphaBravo authorized the reused
Astronomer UI under Apache-2.0 on October 11. LICENSE/NOTICE and owned package
metadata now reflect that authorization. VERSION is `0.2.0-rc.1`; final 0.2.0 has
not been declared or published. See [release setup](releasing.md).

Validation completed in this pass:

- Four release-automation tests cover version/license drift, missing signing
  configuration, mixed provenance, unsafe artifact paths, tampered hashes, and
  rejection of dirty or missing checkout provenance for unsigned release drafts.
- ESLint (including release scripts), TypeScript/production build, actionlint
  1.7.12 for all workflows, ShellCheck for the new shell scripts, and whitespace checks.
- Linux AppImage/DEB/RPM rebuilt at 0.2.0-rc.1; RPM metadata reports Apache-2.0.
  Bundles include LICENSE, NOTICE, 350 dependency notices and the dependency
  inventory, alongside Electron/Chromium's own notices.
- Three desktop unit tests and the packaged Linux browser test passed.
- The container image rebuilt successfully; non-root startup, health endpoint,
  version/license labels, and bundled license/notice files passed smoke checks.
- An isolated, temporary RSA test key signed copies of the candidate RPM and Linux
  checksum list. Signature verification and all three checksums passed. The signed
  RPM passed key import/signature verification, installation, both runtime checks,
  and removal on pinned UBI 8, 9 and 10. Temporary private keys were removed.
- Linux candidate artifacts were staged with exact-version hashes and a manifest
  explicitly recording the dirty local checkout and unsigned distribution state.

Production signing/notarization is deferred by user decision (2026-10-12);
unsigned distribution is accepted for now. Production keys have not been supplied. No self-hosted native desktop
runners were registered at inspection time. Mac/Windows signing/notarization and
native installer execution, and graphical RHEL with SELinux Enforcing, remain
unexecuted. Hosted native tests and UBI checks gate unsigned prerelease drafts; workstation
validation gates stable drafts and signed runs. Signature checks are required
only when signing is explicitly enabled;
its existence is not evidence that they passed. No GitHub workflow, tag, or public
release was created during this pass. Earlier 0.1.0 artifacts are historical;
only exact current-version files enter the new release staging directories.

## Cleanup pass (2026-10-11)

Plugins are now deferred from the default UI and API. Set `ASTRONOMER_LITE_PLUGINS_ENABLED=true` to retain the opt-in flows tested below; existing plugin data is preserved. Default-mode regression coverage checks hidden plugin settings and rejected extension requests. Plugin fixtures explicitly opt in.

The cleanup removes the unused action-plugin seam, duplicate backend navigation registry, unreachable StatusDot component and unused decorative CSS. Built-in navigation has its own shared registry. Resource/pod details, related inventories and YAML editing are separated from list pages. Search and pagination share components, form controls share global styles, and YAML creation uses the accessible shared dialog.

Frontend builds enforce unused locals/parameters. `npm run lint` also checks desktop CommonJS, maintenance scripts and the Headlamp JSX runtime, with zero warnings allowed. CI is configured to run the desktop launcher tests on ordinary pull requests. A source-import reachability check found all 89 production TS/TSX modules reachable from the app entry point, including lazy routes; that is not a guarantee that every exported symbol or runtime path is necessary.

Fresh cleanup validation passed:

- Go tests/vet/build and golangci-lint (zero issues); race checks for auth and server.
- Frontend lint (including desktop/scripts/compatibility runtime), TypeScript/build and 48 unit tests.
- 54 existing Chromium tests on single-node k3d 1.36.5 plus the new YAML-dialog regression (55 total); real-cluster RBAC/user-isolation checks.
- All 7 account/plugin/gateway browser tests with the explicit plugin opt-in.
- Three desktop unit tests and one rebuilt Linux packaged-app browser test, including default-disabled plugin UI/API assertions.
- Workflow YAML/shell syntax, whitespace checks, and inspection of light-theme resource-table and YAML-dialog screenshots.

The 1.30 cluster suite, OIDC-provider browser flow, non-Linux installers and UBI RPM checks were not rerun during this cleanup. Existing installers in `desktop/dist` remain earlier development artifacts; only the Linux unpacked application was rebuilt for this pass.

The historical checks below remain the broader verification record. Native OS/signing limits are unchanged; neither a release tag nor a version bump is part of this cleanup.

## Executed checks

| Check | Result and coverage |
|---|---|
| Go unit tests, vet, build | Passed across all packages |
| Go race detector | Passed for auth, kubeconfig, credential helpers, plugins, forwarding gateway and server packages |
| golangci-lint 2.12.2 | Passed, zero issues |
| Frontend | ESLint, TypeScript, production build and 48 unit tests passed |
| Kubernetes 1.30.4+k3s1 | All 54 Chromium tests passed on one server, zero agents; real-cluster server-mode RBAC/isolation check passed afterward |
| Kubernetes 1.36.5+k3s1 | All 54 Chromium tests passed on one server, zero agents; server-mode RBAC/isolation passed. An earlier run was externally terminated and excluded. |
| Local accounts | All 7 server browser tests passed (6 account/plugin tests plus the forward handoff): accounts/isolation, MFA/recovery/revocation, signed catalog install/update, plugin permissions, theme/density, password revocation |
| Forward browser handoff | Browser regression passed for a cross-site link establishing the Strict/HttpOnly cookie using the actual embedded bootstrap document; real proxy/ticket/revocation behavior covered separately in Go |
| Real OIDC provider | Dex 2.43.0 pinned container: browser login, fresh-ID-token refresh after expiry and local-login fallback passed |
| Desktop launcher | 3 desktop tests passed, including binary OS/CPU mismatch rejection and real-server checks: capability isolation, workspace lock, restart/stable origin, rotated capability and EOF shutdown |
| Packaged Linux desktop | Browser test passed under Xvfb: branded workspace/Settings, no renderer Node API, protected local API, second-instance exit and server shutdown |
| Desktop artifacts | Linux AppImage/deb plus RHEL x86_64 RPM, Windows x64 NSIS and Intel/Apple Silicon Mac ZIPs built in `desktop/dist`; each target bundles a verified matching Go executable |
| RHEL 8/9/10 | RPM format 4 installation, Electron runtime/library loading, packaged Go child, private API, shutdown and DNF removal passed on all three pinned official Red Hat UBI images; no graphical/SELinux workstation claim |
| Container | `astronomer-lite:parity-complete`, 23,783,804 bytes; non-root, protected APIs, `0600` account store, login, three examples, restart persistence/session revocation passed; smoke container/volume removed |
| Dependencies | Full npm audits for web, desktop and compatibility runtime each report zero advisories |
| Configuration | Compose files and CI workflows parse; shell/Python runners pass syntax checks; `git diff --check` passes |
| Visual review | Desktop/mobile login and navigation, light/dark resource tables, Settings and packaged desktop screenshots inspected; Lite Orbit/AlphaBravo branding retained |

The final Kubernetes tests caught and fixed a direct-token connection navigation bug: importing returns all clusters, so the UI now opens the matching reviewed connection. Gateway policy operations and creation/watch descriptors now use the cluster's discovered served version; Kubernetes 1.36 serves BackendTLSPolicy v1 instead of the older v1alpha3 fixture. The account suite now waits for logout navigation before beginning another login.

The unmodified upstream Headlamp pod-counter example was built with its original lockfile/tooling (`@kinvolk/headlamp-plugin` 0.13.1), then wrapped with a Lite permission manifest. Browser coverage checks real pod counts, persisted ConfigStore settings, frame isolation and undeclared-secret denial. This verifies the [documented profile](headlamp-plugins.md), not all upstream packages.

Go tests additionally cover RFC TOTP vectors/replay, recovery consumption, MFA enrollment races, verified OIDC refresh/group changes, proxy identity withdrawal/substitution, forwarded-address validation, login limits, helper clean environment/user/server restrictions, signed package tampering/downgrade/update-disable, plugin-settings workspace isolation and HTTP/WebSocket forwarding revocation. Real-cluster tests verify read-only Kubernetes credentials cannot mutate resources or install Helm releases, including through plugins.

## Bounded load measurement

A 120-second run used 20 independent kubeconfig contexts pointing to **one physical k3d 1.30.4 cluster**, 1,000 temporary ConfigMaps and eight concurrent request workers. It exercised resource inventory, pods, namespace lists and topology after warming every context. Other local browser/build workloads were active on the same host.

- 10,648 successful requests; zero HTTP/inventory errors.
- Latency: p50 19.74 ms, p95 130.66 ms, p99 214.84 ms.
- Server RSS: 94,994,432 bytes after warmup, 135,569,408 peak, 104,546,304 final.

This short synthetic test checks bounded behavior and untruncated owned-object inventory. It does not establish production fleet capacity, long-term leak freedom, or performance against Headlamp. Kubernetes automatically adds a root-CA ConfigMap; the inventory assertion counts the test-owned objects rather than assuming the namespace contains nothing else.

## Reproduce

```sh
(cd web && npm ci)
make verify-local
(cd server && golangci-lint run ./...)
(cd server && go test -race ./internal/auth ./internal/kubeconfig ./internal/credentials ./internal/plugins ./internal/forward ./internal/server)
(cd web && npx playwright install --with-deps chromium)
(cd web && npm run e2e:server && npm run e2e:oidc)
K3D_AGENTS=0 K3D_IMAGE=rancher/k3s:v1.30.4-k3s1 make k3d-e2e
K3D_AGENTS=0 K3D_IMAGE=rancher/k3s:v1.36.5-k3s1 make k3d-e2e
make desktop
(cd desktop && npm test)
(cd web && npm run e2e:desktop)
make image image-size
```

The desktop browser runner automatically uses `xvfb-run` on headless Linux, which must be installed. This host uses Go 1.26.4 and Node 22.22.1; the image uses Go 1.26/Node 24. Chromium needs `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` on this Ubuntu 26.04 host. Desktop tests disable the OS sandbox only when running as root; the application defaults to sandboxed renderers.

The gated `.github/workflows/e2e.yml` tests both k3d image versions with one node. `.github/workflows/ci.yml` covers account and real-Dex browser tests, and `.github/workflows/desktop.yml` defines native packaging jobs. These workflow definitions were validated locally; no GitHub Actions run was triggered in this session.

For the bounded load test, retain an owned test cluster and use:

```sh
python3 scripts/soak-k3d.py --kubeconfig .kube/config --contexts 20 --objects 1000 --concurrency 8 --duration 120 --output /tmp/lite-soak.json
```

It requires an explicitly selected `k3d-*` context, creates one temporary namespace and removes it afterward. It never modifies ordinary cluster objects. Traces/screenshots remain under ignored `web/test-results*` directories.

## Limits

- Mac ZIPs and Windows NSIS were cross-built on Linux; native Mac/Windows execution and DMG creation remain CI/release checks. RPM runtime passes on Red Hat UBI 8/9/10, while actual RHEL graphical desktop/SELinux behavior remains unverified. Signing/notarization are not configured, and no installer was published.
- No production cloud account, enterprise IdP, trusted reverse-proxy deployment or public wildcard TLS/DNS gateway was available. Controlled helper/proxy/gateway tests and real Dex verification do not replace those environment-specific checks.
- Dex 2.43.0 is the verified pinned fixture. An attempted Dex 2.46.0 fixture stalled at refresh and is not represented as passing.
- The T3 collaborative preview attached but navigation to the test server timed out; visual inspection used artifacts from repository browser tests.
- Large frontend chunks still produce Vite advisory warnings; the Headlamp runtime is lazy-loaded with its extension page. The build succeeds.
- Zero npm advisories are a dependency snapshot, not an application security audit. Plugins remain operator-trusted code.
- HA/multiple replicas and a shared database are intentionally excluded. Full Headlamp SDK/catalog compatibility and production-fleet performance are not claimed.
