#!/usr/bin/env bash
# Install the actual RPM and exercise both shipped runtimes on a Red Hat base.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPM_FILE="${1:?Usage: verify-rpm.sh PATH_TO_RPM 8|9|10}"
RHEL_MAJOR="${2:?Select RHEL major version 8, 9 or 10}"
case "$RHEL_MAJOR" in
  8) IMAGE=registry.access.redhat.com/ubi8/ubi@sha256:b76f9ead999002af783d7b7036b7b57ceee6033712ad07577240ee06489a3a40 ;;
  9) IMAGE=registry.access.redhat.com/ubi9/ubi@sha256:5858f9ace07316e3b12caab62f6c2481a5030bb6bafdca5a9ea324c321ef36df ;;
  10) IMAGE=registry.access.redhat.com/ubi10/ubi@sha256:27e14f4987d7abe56664d7e1b1dddcd0226d4ca593da5726f0f65697a17d0fee ;;
  *) echo 'Only RHEL 8, 9 and 10 are covered' >&2; exit 2 ;;
esac
RPM_FILE="$(realpath "$RPM_FILE")"
KEY_MOUNT=()
if [[ -f "$(dirname "$RPM_FILE")/linux-signing-key.asc" ]]; then
  KEY_MOUNT=(--mount "type=bind,src=$(dirname "$RPM_FILE")/linux-signing-key.asc,dst=/tmp/lite-key.asc,readonly")
fi
exec docker run --rm --init --platform linux/amd64 \
  --mount "type=bind,src=$RPM_FILE,dst=/tmp/astronomer-lite.rpm,readonly" \
  --mount "type=bind,src=$ROOT_DIR/scripts/rpm-runtime-smoke.cjs,dst=/tmp/smoke.cjs,readonly" \
  "${KEY_MOUNT[@]}" "$IMAGE" bash -euc '
    if test -f /tmp/lite-key.asc; then rpm --import /tmp/lite-key.asc; rpmkeys --checksig /tmp/astronomer-lite.rpm; fi
    dnf -y --setopt=install_weak_deps=False install /tmp/astronomer-lite.rpm
    rpm -q astronomer-lite-desktop
    ldd /opt/Astronomer-Lite/astronomer-lite > /tmp/linked-libraries
    cat /tmp/linked-libraries
    if grep -q "not found" /tmp/linked-libraries; then exit 1; fi
    ELECTRON_RUN_AS_NODE=1 /opt/Astronomer-Lite/astronomer-lite /tmp/smoke.cjs
    dnf -y remove astronomer-lite-desktop
    test ! -e /usr/bin/astronomer-lite
    test ! -e /opt/Astronomer-Lite/astronomer-lite
    echo "RPM install/runtime/uninstall passed"
  '
