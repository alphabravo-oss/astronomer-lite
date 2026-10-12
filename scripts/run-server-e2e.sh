#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/astronomer-lite-server-test.XXXXXX")"
SERVER_PID=""
CATALOG_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  if [[ -n "$CATALOG_PID" ]]; then kill "$CATALOG_PID" 2>/dev/null || true; wait "$CATALOG_PID" 2>/dev/null || true; fi
  rm -rf "$TEST_CONFIG_DIR"
}
trap cleanup EXIT
trap 'exit 0' TERM INT
# An isolated test-only bootstrap credential. Never used by a deployed server.
printf '%s' 'test-only-password-1234' > "$TEST_CONFIG_DIR/bootstrap"
chmod 600 "$TEST_CONFIG_DIR/bootstrap"
cp -R "$ROOT_DIR/examples/plugins" "$TEST_CONFIG_DIR/plugins"
node "$ROOT_DIR/scripts/create-plugin-catalog-fixture.mjs" "$TEST_CONFIG_DIR"
python3 -m http.server 18084 --bind 127.0.0.1 --directory "$TEST_CONFIG_DIR/catalog" > "$TEST_CONFIG_DIR/catalog.log" 2>&1 &
CATALOG_PID=$!
ASTRONOMER_LITE_AUTH_MODE=server \
ASTRONOMER_LITE_CONFIG_DIR="$TEST_CONFIG_DIR" \
ASTRONOMER_LITE_PUBLIC_URL=http://127.0.0.1:18083 \
ASTRONOMER_LITE_ADMIN_USER=admin \
ASTRONOMER_LITE_ADMIN_PASSWORD_FILE="$TEST_CONFIG_DIR/bootstrap" \
ASTRONOMER_LITE_ALLOWED_CLUSTER_SERVERS=https://127.0.0.1:1 \
ASTRONOMER_LITE_PLUGINS_ENABLED=true \
ASTRONOMER_LITE_PLUGINS_DIR="$TEST_CONFIG_DIR/plugins" \
ASTRONOMER_LITE_PLUGIN_CATALOG_URL=http://127.0.0.1:18084/index.json \
ASTRONOMER_LITE_PLUGIN_TRUST_KEY_FILE="$TEST_CONFIG_DIR/publisher-keys/publisher.pub" \
ASTRONOMER_LITE_OIDC_ISSUER= \
ASTRONOMER_LITE_OIDC_CLIENT_ID= \
ASTRONOMER_LITE_OIDC_CLIENT_SECRET_FILE= \
PORT=18083 "$ROOT_DIR/server/bin/astronomer-lite" &
SERVER_PID=$!
wait "$SERVER_PID"
