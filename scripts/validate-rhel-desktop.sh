#!/usr/bin/env bash
# Run from an interactive, non-root GNOME session on a disposable RHEL VM.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPM_FILE="$(realpath "${1:?Usage: validate-rhel-desktop.sh PACKAGE.rpm 8|9|10}")"
MAJOR="${2:?Missing RHEL major}"
# shellcheck source=/dev/null
source /etc/os-release
: "${XDG_CURRENT_DESKTOP:=}"
[[ "$ID" == rhel && "${VERSION_ID%%.*}" == "$MAJOR" && "$MAJOR" =~ ^(8|9|10)$ ]] || { echo 'Wrong RHEL host' >&2; exit 1; }
[[ "$(id -u)" != 0 ]] || { echo 'Run from a normal desktop user account' >&2; exit 1; }
[[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] || { echo 'A real graphical desktop session is required' >&2; exit 1; }
[[ "${XDG_CURRENT_DESKTOP,,}" == *gnome* ]] || { echo 'GNOME desktop session required' >&2; exit 1; }
[[ "$(getenforce)" == Enforcing ]] || { echo 'SELinux must be Enforcing' >&2; exit 1; }
if rpm -q astronomer-lite-desktop >/dev/null 2>&1; then echo 'Use a disposable VM without an existing Lite installation' >&2; exit 1; fi
sudo -n true
cleanup() { sudo -n dnf -y remove astronomer-lite-desktop; }
trap cleanup EXIT
if [[ "${LITE_SIGNED_RELEASE:-false}" == true ]]; then
  sudo -n rpm --import "$(dirname "$RPM_FILE")/linux-signing-key.asc"
  rpmkeys --checksig "$RPM_FILE"
fi
sudo -n dnf -y install "$RPM_FILE"
export LITE_DESKTOP_EXECUTABLE="/opt/Astronomer Lite/astronomer-lite"
# Require a native display: do not use the Xvfb convenience wrapper here.
if [[ -z "${DISPLAY:-}" ]]; then export LITE_DESKTOP_OZONE_PLATFORM=wayland; fi
cd "$ROOT_DIR/web"
./node_modules/.bin/playwright test --config playwright.desktop.config.ts --reporter=line,json
sudo -n dnf -y remove astronomer-lite-desktop
trap - EXIT
test ! -e "/opt/Astronomer Lite/astronomer-lite"
test ! -e /usr/bin/astronomer-lite
printf 'RHEL %s GNOME install/launch/uninstall passed with SELinux Enforcing\n' "$MAJOR"
