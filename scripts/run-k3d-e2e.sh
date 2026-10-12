#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-astronomer-lite}"
CLUSTER_AGENTS="${K3D_AGENTS:-1}"
PORT="${ASTRONOMER_LITE_E2E_PORT:-18080}"
BASE_URL="http://127.0.0.1:${PORT}"
KUBECONFIG_PATH="${KUBECONFIG_PATH:-${ROOT_DIR}/.kube/config}"
CONFIG_DIR_CREATED=0

if [[ -z "${ASTRONOMER_LITE_CONFIG_DIR:-}" ]]; then
  ASTRONOMER_LITE_CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/astronomer-lite-e2e.XXXXXX")"
  CONFIG_DIR_CREATED=1
fi

SERVER_LOG="${SERVER_LOG:-${ASTRONOMER_LITE_CONFIG_DIR}/astronomer-lite.log}"
SERVER_PID=""
CLUSTER_CREATED=0

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

cleanup() {
  local status=$?
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -f "${SERVER_LOG}" ]]; then
    echo
    echo "astronomer-lite server log: ${SERVER_LOG}"
    tail -n 200 "${SERVER_LOG}" || true
  fi
  if [[ "${CLUSTER_CREATED}" == "1" && "${KEEP_K3D_CLUSTER:-0}" != "1" ]]; then
    k3d cluster delete "${CLUSTER_NAME}" >/dev/null 2>&1 || true
  fi
  if [[ "${CONFIG_DIR_CREATED}" == "1" && "${KEEP_E2E_CONFIG_DIR:-0}" != "1" ]]; then
    rm -rf "${ASTRONOMER_LITE_CONFIG_DIR}"
  fi
  exit "${status}"
}
trap cleanup EXIT

require_command curl
require_command k3d
require_command kubectl
require_command make
require_command node
require_command npm
require_command python3

cd "${ROOT_DIR}"

if k3d cluster list "${CLUSTER_NAME}" >/dev/null 2>&1; then
  if [[ "${REUSE_K3D_CLUSTER:-0}" != "1" ]]; then
    echo "k3d cluster ${CLUSTER_NAME} already exists; set REUSE_K3D_CLUSTER=1 to reuse it or delete it first" >&2
    exit 1
  fi
else
  image_args=()
  if [[ -n "${K3D_IMAGE:-}" ]]; then image_args=(--image "$K3D_IMAGE"); fi
  k3d cluster create "${CLUSTER_NAME}" --servers 1 --agents "${CLUSTER_AGENTS}" "${image_args[@]}" --wait --kubeconfig-update-default=false --kubeconfig-switch-context=false
  CLUSTER_CREATED=1
fi

mkdir -p "$(dirname "${KUBECONFIG_PATH}")"
k3d kubeconfig get "${CLUSTER_NAME}" > "${KUBECONFIG_PATH}"
kubectl --kubeconfig "${KUBECONFIG_PATH}" config set-cluster astronomer-lite-unreachable --server=https://127.0.0.1:1 --insecure-skip-tls-verify=true >/dev/null
kubectl --kubeconfig "${KUBECONFIG_PATH}" config set-credentials astronomer-lite-unreachable --token=dummy >/dev/null
kubectl --kubeconfig "${KUBECONFIG_PATH}" config set-context astronomer-lite-unreachable --cluster=astronomer-lite-unreachable --user=astronomer-lite-unreachable >/dev/null
kubectl --kubeconfig "${KUBECONFIG_PATH}" wait --for=condition=Ready nodes --all --timeout=120s

if [[ "${SKIP_NPM_CI:-0}" != "1" ]]; then
  (cd web && npm ci)
fi
if [[ "${SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]]; then
  (cd web && npx playwright install --with-deps chromium)
fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then make build; fi

mkdir -p "${ASTRONOMER_LITE_CONFIG_DIR}"
ASTRONOMER_LITE_CONFIG_DIR="${ASTRONOMER_LITE_CONFIG_DIR}" \
  KUBECONFIG="${KUBECONFIG_PATH}" \
  ASTRONOMER_LITE_AUTH_MODE=single-user \
  ASTRONOMER_LITE_PLUGINS_ENABLED=true \
  ASTRONOMER_LITE_PLUGINS_DIR="${ASTRONOMER_LITE_PLUGINS_DIR:-${ROOT_DIR}/examples/plugins}" \
  PORT="${PORT}" \
  ./server/bin/astronomer-lite > "${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "${BASE_URL}/" >/dev/null; then
    break
  fi
  if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    echo "astronomer-lite exited before becoming ready" >&2
    exit 1
  fi
  sleep 1
done

curl -fsS "${BASE_URL}/" >/dev/null

for _ in $(seq 1 60); do
  clusters_json="$(curl -fsS "${BASE_URL}/api/clusters" 2>/dev/null || true)"
  if [[ -n "${clusters_json}" ]] && node -e '
    const clusters = JSON.parse(process.argv[1]);
    const hasReachable = clusters.some((cluster) => cluster.reachable === true);
    const hasExpectedUnreachable = clusters.some((cluster) => cluster.context === "astronomer-lite-unreachable" && cluster.status === "unreachable");
    process.exit(hasReachable && hasExpectedUnreachable ? 0 : 1);
  ' "${clusters_json}"; then
    break
  fi
  if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    echo "astronomer-lite exited before clusters became ready" >&2
    exit 1
  fi
  sleep 1
done

clusters_json="$(curl -fsS "${BASE_URL}/api/clusters")"
node -e '
  const clusters = JSON.parse(process.argv[1]);
  const hasReachable = clusters.some((cluster) => cluster.reachable === true);
  const hasExpectedUnreachable = clusters.some((cluster) => cluster.context === "astronomer-lite-unreachable" && cluster.status === "unreachable");
  if (!hasReachable || !hasExpectedUnreachable) {
    console.error("clusters did not become ready for e2e:", JSON.stringify(clusters, null, 2));
    process.exit(1);
  }
' "${clusters_json}"

cd web
E2E_BASE_URL="${BASE_URL}" \
  KUBECONFIG="${KUBECONFIG_PATH}" \
  EXPECT_UNREACHABLE_CONTEXT=astronomer-lite-unreachable \
  npm run e2e

cd "${ROOT_DIR}"
python3 scripts/verify-k3d-server-mode.py --kubeconfig "${KUBECONFIG_PATH}"
