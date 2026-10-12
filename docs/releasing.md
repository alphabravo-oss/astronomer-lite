# Releasing Astronomer-Lite

## License and version

AlphaBravo confirmed on October 11, 2026 that it controls the necessary rights
and authorizes reused Astronomer UI code/assets under Apache-2.0 in Lite. Root
`LICENSE` and `NOTICE` record the choice and provenance. This closes the owned-code
licensing decision; third-party code keeps its original licenses. The upstream
Astronomer repository itself remains under its existing license.

`VERSION` is the canonical release version. Update it with:

```sh
node scripts/release-version.cjs set 0.2.0-rc.2
# Write release/notes/0.2.0-rc.2.md with the actual changes and limitations.
make release-check
```

This synchronizes the web, compatibility layer, and desktop package manifests
and lockfiles. Make and desktop builds stamp the Go server version. Direct
Docker builds default to `dev`; use `make image` for version/revision labels.
`go run` without release ldflags intentionally remains `dev`.

Packaging generates `release/generated/THIRD-PARTY-NOTICES.txt` and
`dependencies.json`. It preserves original license/notice texts from production
npm packages and Go modules used on supported desktop targets. Missing texts
fail packaging; reviewed exceptions are version-specific in `release/licenses`.
Nested vendored license files are included. The dependency inventory is
conservative, not a complete Electron or base-OS SBOM. Electron/Chromium notices
also ship with Electron. Containers include the application notices under
`/usr/share/licenses/astronomer-lite`; base-image packages retain their licenses.

## Current release policy

Production signing/notarization is deferred by user decision on October 12, 2026.
Unsigned distribution is accepted for now. Signing credentials are not a blocker
for this path; native platform validation remains a stable-release readiness requirement.
Signing support stays available for later use. Tag builds default to unsigned;
set repository variable `DESKTOP_RELEASE_SIGNING_ENABLED=true` to opt tag releases
into production signing later. Manual runs select signing with `signed=true`.

## Build and validate an unsigned candidate

Commit the intended source changes, push a branch, and run **Desktop packages**
in GitHub Actions with `signed=false`. The workflow builds Linux x64, Windows
x64, macOS x64, and macOS arm64. It installs the NSIS/DMG packages on hosted
Windows/macOS runners, tests the packaged UI, and checks the RPM on UBI 8/9/10.
Unsigned macOS packages are test artifacts and may be blocked when downloaded
on another Mac. UBI runtime checks do not establish graphical RHEL validation.

```sh
gh workflow run desktop.yml --ref YOUR_BRANCH -f signed=false
```

To build locally (Node 22+, Go matching `server/go.mod`, platform packaging tools):

```sh
cd web && npm ci && cd ..
make build
cd desktop && npm ci && npm run package && cd ..
make desktop-test
node scripts/release-artifacts.cjs stage linux-x64
```

Use the correct target for staging: `linux-x64`, `win-x64`, `mac-x64`, or
`mac-arm64`. Staging copies only the exact current-version installers, regenerates
hashes after signing, and records revision, dirty state, target, and signing mode.
It refuses to reuse an existing staging directory. A dirty local build is labeled
as such and cannot be staged for a release draft, signed or unsigned.

## Optional signing accounts and GitHub configuration

Skip this section while signing is deferred. Account enrollment, verified
publisher identity, and private signing credentials
must come from AlphaBravo. The repository cannot create these identities.
The signed workflow fails on missing credentials and never substitutes unsigned
packages. Signing jobs use the `desktop-signing` GitHub environment. Restrict that
environment to trusted release branches/tags and authorized maintainers in GitHub.
The workflow has no pull-request trigger and does not publish a release automatically.

Supply these **environment secrets**:

| Platform | Secrets |
| --- | --- |
| macOS | `MAC_CSC_LINK` (base64 Developer ID Application `.p12`), `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64` (base64 App Store Connect `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Windows | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` for an Artifact Signing identity with the Certificate Profile Signer role |
| Linux | `RPM_SIGNING_KEY_BASE64` (base64 exported private RSA key), `RPM_SIGNING_PASSPHRASE` |

Supply these **environment variables** in `desktop-signing`:

| Variable | Value |
| --- | --- |
| `WINDOWS_PUBLISHER_NAME` | Exact verified certificate publisher name |
| `AZURE_SIGNING_ENDPOINT` | Artifact Signing regional endpoint |
| `AZURE_SIGNING_ACCOUNT` | Signing account name |
| `AZURE_SIGNING_PROFILE` | Certificate profile name |
| `RPM_SIGNING_FINGERPRINT` | Full 40-character primary RSA key fingerprint |

`./scripts/configure-release.sh` creates missing release environments and uploads
only the above values that are present in its process environment. It preserves
unspecified values and existing environment settings. It uses the authenticated
`gh` account and changes the repository settings when explicitly run. Do not use
shell tracing or commit credentials; use your secret manager to inject values.

Apple builds sign the app and bundled Go executable, notarize and staple the app,
notarize/staple the signed DMG too, and verify both the DMG and installed app
with `codesign`, `spctl`, and `stapler`.
Windows uses electron-builder's Azure signing integration, including executable
extra resources; verification checks the app, Go executable, and installer for a
valid expected publisher and timestamp. Linux signs the RPM with RSA/SHA256 and
signs checksums covering all three Linux installers. The public key ships alongside
the checksums; distribute its fingerprint independently through a trusted channel.
Private keyrings and temporary Apple API keys are removed after use.

## Native workstation runners

Provision disposable, dedicated desktop VMs. Register GitHub Actions self-hosted
runners for this repository with these labels:

| Host | Labels in addition to GitHub defaults |
| --- | --- |
| RHEL 8 x64 GNOME | `lite-rhel-8` |
| RHEL 9 x64 GNOME | `lite-rhel-9` |
| RHEL 10 x64 GNOME | `lite-rhel-10` |
| Windows 11 x64 | `lite-windows-11` |

For RHEL, install GNOME, Node 22 prerequisites, git, npm access, RPM/DNF and SELinux
tools. Keep SELinux Enforcing. Use a normal test user with passwordless sudo on
these disposable VMs and no existing Lite installation. Start the Actions runner
with `./run.sh` **from a logged-in GNOME terminal**, preserving `DISPLAY` and/or
`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, `XDG_CURRENT_DESKTOP`, and the session D-Bus
environment. A background service with no desktop session is insufficient.
Do not use Xvfb or disable the sandbox/SELinux for the native gate. Wayland-only
sessions pass Electron's Wayland option explicitly. The workflow installs the
actual RPM, runs the packaged UI test, and verifies removal.

For Windows 11, run the agent interactively in a logged-in test account, not as a
Session 0 service. The validation script rejects Windows Server when the Windows
11 gate is requested. It silently installs into a unique temporary directory,
launches the installed app, tests it, and checks uninstall cleanup.

After these runners are registered and their sessions work, set the repository
variable `NATIVE_WORKSTATION_RUNNERS_READY=true`. This is an operator readiness
switch, not a validation result. Stable release drafts and signed runs must still pass all native jobs.
The unsigned workflow can exercise them first with `native_workstations=true`.
Screenshots and JSON test results are retained as workflow artifacts. Hosted Mac
jobs cover Intel and Apple Silicon. The UI test checks workspace loading, settings,
default plugin deferral, renderer isolation, private-server protection, single
instance behavior, and shutdown. Broader Kubernetes operations are covered by the
separate k3d browser suite. These checks do not prove every OS integration or
replace a final downloaded-installer user acceptance check.

## Release draft and final review

Run the workflow with `create_draft=true` to create an unsigned draft, or push a
tag exactly matching `v$(cat VERSION)`. Tags default to unsigned while
`DESKTOP_RELEASE_SIGNING_ENABLED` is unset or false. Unsigned prerelease drafts require successful hosted native tests and UBI
8/9/10 checks, and disclose outstanding Windows 11/graphical RHEL validation.
Stable drafts and signed runs additionally require the native-runner readiness
variable and all four workstation jobs. It verifies all eight installer hashes and
requires matching version, source revision, target, clean source, and signing
mode before creating a **draft** GitHub release. Existing releases/assets are
never overwritten. Unsigned drafts explicitly disclose their signing status.

```sh
gh workflow run desktop.yml --ref YOUR_RELEASE_BRANCH -f create_draft=true -f signed=false
```

Later, `signed=true` creates a signed draft and additionally requires production
credentials and signature/notarization verification. It never silently falls back
to unsigned packages if signing fails.

For public 0.2.0, set version `0.2.0`, write its final notes, commit, and run the
draft workflow on that commit. Review the draft and native validation evidence,
then publish explicitly. Release candidates use the prerelease flag automatically.
No release is marked ready merely because these automation files exist.

References: [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
[Microsoft Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart),
[electron-builder signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/).

## Container image

Publishing a GitHub release triggers `.github/workflows/container.yml` to build,
smoke-test, and push the Linux x64 image to
`ghcr.io/alphabravo-oss/astronomer-lite:VERSION`. The image carries the release
version and source revision. Prereleases do not move a `latest` tag. Package
visibility must match the intended release audience. To rerun publication for an
existing release tag, dispatch the container workflow on that tag.
