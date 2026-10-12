# Desktop application

Astronomer Lite Desktop wraps the embedded Go server and Astronomer-styled UI in Electron. It retains the Orbit mark, blue/violet colors and AlphaBravo attribution. One private workspace runs per profile; there is no database or HA mode.

## Platforms and artifacts

| Platform | Architecture | Package | Verification |
|---|---|---|---|
| macOS Intel | x64 | DMG and ZIP containing `.app` and installation guide | Installed DMG and UI tests passed on hosted macOS; production signing deferred |
| macOS Apple Silicon | arm64 | DMG and ZIP containing `.app` and installation guide | Installed DMG and UI tests passed on hosted macOS; production signing deferred |
| Windows | x64 | NSIS `.exe` installer, per-user | Install/UI/uninstall passed on hosted Windows Server 2025; Windows 11 workstation validation pending |
| RHEL 8, 9 and 10 | x86_64 | RPM | Install, runtime loading, private API, shutdown and removal passed on Red Hat UBI for every major version |
| Other Linux | x64 | AppImage / deb | Packaged desktop browser test passed on Ubuntu |

The published 0.2.0-rc.2 [desktop validation run](https://github.com/alphabravo-oss/astronomer-lite/actions/runs/38206533148) passed the hosted platform and UBI checks above. Graphical RHEL validation remains pending.

Packages are in `desktop/dist`, with adjacent `.sha256` files for new artifacts. Production signing/notarization is deferred; unsigned prerelease distribution is accepted for now. Native workstation checks remain required for stable release readiness. DMG creation runs on macOS; Linux cross-builds produce Mac ZIPs. Lite is licensed under Apache-2.0 with AlphaBravo authorization for the reused Astronomer UI; third-party licenses are preserved.

## Install

**RHEL 8/9/10:** on an x86_64 machine with a graphical desktop and the usual BaseOS/AppStream repositories enabled:

```sh
sudo dnf install ./Astronomer-Lite-0.2.0-rc.3-linux-x86_64.rpm
astronomer-lite
# Remove the application; private user workspaces remain:
sudo dnf remove astronomer-lite-desktop
```

The same RPM targets all three major versions with current security updates; the checks use the pinned UBI images, not every historical minor release. It uses RPM format 4 and gzip payload compression, declares its GTK/NSS/graphics/audio libraries and a glibc 2.28 minimum. `xdg-utils` (opening external browser links) and `libnotify` (desktop notifications) are recommended dependencies and are normally installed by DNF when available. UBI smoke tests disable weak dependencies because its reduced repositories omit them. On a desktop where weak dependencies were disabled, install `xdg-utils` before using external links.

Run the application as your normal desktop user. The container tests verify ABI/runtime compatibility, not a graphical RHEL workstation with SELinux enforcing. They do not require a subscription and do not disable SELinux or change host policy. The host Ubuntu browser test covers the actual renderer; native RHEL desktop/display/SELinux validation remains a release check.

**Windows:** run `Astronomer-Lite-0.2.0-rc.3-win-x64.exe`, choose the installation directory and launch from the Start menu. The installer is per-user; it does not install a Windows service. Silent installation uses `/S`; `/D=PATH` must be the final argument. Uninstall through Windows Settings or the installed uninstaller.

**macOS:** download the DMG matching Intel (`mac-x64`) or Apple Silicon (`mac-arm64`). Open it and drag `Astronomer Lite.app` (`Astronomer-Lite.app` in 0.2.0-rc.2) onto the Applications shortcut. Open `READ ME FIRST.txt` beside those icons for installation and first-launch instructions. The Mac ZIPs include the same guide beside the app.

Unsigned releases have not been notarized. If macOS says Apple cannot check the app for malicious software, dismiss the warning, open **System Settings → Privacy & Security**, scroll to **Security**, and select **Open Anyway** for Astronomer Lite. Authenticate if requested and confirm **Open**. Use this exception for a trusted copy from our official release. macOS remembers the exception for later launches. See [Apple's instructions](https://support.apple.com/en-us/102445) and the [bundled guide](../desktop/READ%20ME%20FIRST.txt).

## Settings and app name

Open **Astronomer Lite → Settings…** on macOS (**⌘,**) or **File → Settings…** on Windows/Linux (**Ctrl+,**). The gear link in the workspace opens the same Settings page.

The display name is **Astronomer Lite**. Existing desktop profiles remain in the original `Astronomer-Lite` data directory so upgrades retain imported clusters and preferences. Package IDs and release download filenames also remain stable. These naming and menu changes apply from RC.3; RC.2 uses the previous name. When upgrading a Mac, open the new app before removing the old `Astronomer-Lite.app` from Applications.

## Build

Install Go (see `server/go.mod`), Node 22 or newer, and the platform packaging tools. Prepare the UI once:

```sh
(cd web && npm ci)
make build
(cd desktop && npm ci)
```

Then, from `desktop/`, choose a target:

```sh
npm run package:rhel           # RPM, x86_64
npm run package:linux          # AppImage, deb, RPM, x64
npm run package:windows        # NSIS, x64
npm run package:mac            # DMG and ZIP, Intel + Apple Silicon; run on macOS
# Linux cross-build of unsigned Mac ZIPs only:
npx electron-builder --config release-config.cjs --mac zip --x64 --arm64 --publish never
```

Linux RPM builders need `rpm`/`rpmbuild` (`sudo dnf install rpm-build` or `sudo apt-get install rpm`). Cross-building Windows from Linux also needs Wine exposed as `wine`. See the [electron-builder cross-platform guide](https://www.electron.build/v26/docs/features/multi-platform-build/). `make desktop` packages the current platform; on macOS its default targets include both CPU architectures.

Every package invokes `before-pack.cjs`, which builds Go for the **requested target OS/CPU**, ignoring ambient `GOOS`/`GOARCH`. Binaries are isolated in `desktop/bin/<os>-<arch>/`. `after-pack.cjs` checks the actual bundled executable header, rejecting an ELF/PE/Mach-O or CPU mismatch. This prevents packaging a host Linux server into a Windows/Mac app or mixing Intel and Apple Silicon servers.

For development, `(cd desktop && npm run build:server && npm start)` builds/runs the native host target. The explicit build helper also accepts `node build-server.cjs darwin arm64` or `node build-server.cjs win32 x64`.

## CI and verification

`.github/workflows/desktop.yml` builds on Ubuntu x64, Windows x64, Intel macOS and Apple Silicon macOS, using [native runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). It installs the Windows NSIS or mounts/copies the Mac DMG, then runs the packaged-app browser test. Mac jobs also compare the guide in the mounted DMG and ZIP against its source file. A second matrix installs and tests the RPM on pinned official Red Hat UBI 8/9/10 images. Unsigned workflow dispatch uploads candidate artifacts. Unsigned prerelease drafts require hosted native tests and UBI checks; stable drafts and signed runs also require native workstation gates; signing is optional and defaults off. Drafts identify unsigned installers, and publication remains explicit.

```sh
(cd desktop && npm test)
(cd web && npm run e2e:desktop)
./scripts/verify-rpm.sh desktop/dist/Astronomer-Lite-0.2.0-rc.3-linux-x86_64.rpm 8
./scripts/verify-rpm.sh desktop/dist/Astronomer-Lite-0.2.0-rc.3-linux-x86_64.rpm 9
./scripts/verify-rpm.sh desktop/dist/Astronomer-Lite-0.2.0-rc.3-linux-x86_64.rpm 10
```

The RPM harness uses disposable containers and checks DNF install/remove, required shared libraries, the packaged Electron runtime and its Go child, unauthorized API rejection and child shutdown. It leaves host packages/configuration untouched. Desktop tests cover exact capability origin, process locks, restart, executable mismatch rejection, branding/Settings, renderer isolation and second-instance behavior. Headless Linux browser tests require Xvfb. Only root-owned test runs use `--no-sandbox`; the application defaults keep sandboxing enabled.

## Workspace and lifecycle

To add another kubeconfig in the installed app, open **Clusters → Add kubeconfig → Upload file**, choose the file, click **Preview contexts**, select the contexts, then click **Add selected**. Repeat for additional files. Pasting YAML uses the same flow. The web UI provides these same controls; shared server-mode imports belong to the signed-in user and follow the operator's cluster/credential restrictions.

Uploading imports a copy into the workspace; it does not establish a live link to the original file. The desktop does not currently provide a settings screen for selecting additional on-disk kubeconfig paths or configuring credential-helper executable paths.

The launcher reads `KUBECONFIG` or the normal local kubeconfig; install local cloud helpers on PATH. Imports, projects and plugin state live under Electron's user-data directory in `workspace/`; plugin packages go in `workspace/plugins/`. Browser preferences stay in the Electron profile. A remembered loopback port preserves that browser origin; an occupied port causes selection of a different port.

Desktop runs in trusted single-user mode without app login. Shared deployments with local accounts/MFA/SSO use [server mode](server-mode.md). Desktop ignores server deployment environment settings except `ASTRONOMER_LITE_PLUGINS_ENABLED` and the optional plugin catalog URL/trust-key file. Plugins are disabled by default; opt in with `ASTRONOMER_LITE_PLUGINS_ENABLED=true` before launch.

Electron holds one window-instance lock per profile. The Go service also locks its config directory. Electron injects a random per-launch capability only into requests to its exact loopback server; a separate browser cannot access the API without it. Renderer sandboxing/context isolation are enabled; Node integration and permission requests are disabled. External HTTP(S) links require confirmation before opening in the OS browser.

Closing the app ends the Go child, streams and forwards; stdin EOF also stops the service if the launcher crashes. There is no update daemon, background service, database or multi-replica coordination.

Release versioning, Apache-2.0 attribution, signed installer automation, and native
Windows 11/RHEL desktop runner setup are documented in [releasing.md](releasing.md).
