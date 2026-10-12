#!/usr/bin/env python3
"""Exercise server-mode isolation and Kubernetes RBAC on an explicit k3d context."""
import argparse
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kubeconfig", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    kubeconfig = str(Path(args.kubeconfig).resolve())

    def kubectl(*arguments, body=None):
        return subprocess.check_output(
            ["kubectl", "--kubeconfig", kubeconfig, *arguments],
            input=None if body is None else json.dumps(body), text=True,
        )

    config = json.loads(kubectl("config", "view", "--minify", "--raw", "-o", "json"))
    if not config["current-context"].startswith("k3d-"):
        raise SystemExit("This check requires an explicitly selected k3d context.")
    namespace = "lite-auth-check-" + secrets.token_hex(4)
    password = secrets.token_urlsafe(24)
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    checks = []

    def client():
        return urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def request(who, method, path, body=None, expected=200):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(
            origin + path, data=data, method=method,
            headers={"Content-Type": "application/json", "X-Astronomer-Lite": "1", "Origin": origin},
        )
        try:
            with who.open(req, timeout=30) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        if status != expected:
            # Bodies could contain cluster data; keep failures credential-free.
            raise AssertionError(f"{method} {path}: expected {expected}, got {status}")
        return json.loads(raw) if raw else None

    with tempfile.TemporaryDirectory(prefix="lite-auth-check-") as folder:
        state = Path(folder)
        secret = state / "bootstrap"
        secret.write_text(password)
        secret.chmod(0o600)
        env = dict(os.environ)
        env.update({
            "PORT": str(port), "KUBECONFIG": kubeconfig,
            "ASTRONOMER_LITE_AUTH_MODE": "server",
            "ASTRONOMER_LITE_PUBLIC_URL": origin,
            "ASTRONOMER_LITE_CONFIG_DIR": str(state / "state"),
            "ASTRONOMER_LITE_ADMIN_USER": "admin",
            "ASTRONOMER_LITE_ADMIN_PASSWORD_FILE": str(secret),
            "ASTRONOMER_LITE_ALLOWED_CLUSTER_SERVERS": config["clusters"][0]["cluster"]["server"],
            "ASTRONOMER_LITE_PLUGINS_ENABLED": "true",
            "ASTRONOMER_LITE_PLUGINS_DIR": str(root / "examples/plugins"),
            "ASTRONOMER_LITE_OIDC_ISSUER": "",
            "ASTRONOMER_LITE_OIDC_CLIENT_ID": "",
            "ASTRONOMER_LITE_OIDC_CLIENT_SECRET_FILE": "",
        })
        with (state / "server.log").open("w") as log:
            process = subprocess.Popen([str(root / "server/bin/astronomer-lite")], env=env, stdout=log, stderr=log)
            created = False
            try:
                anonymous, admin, reader = client(), client(), client()
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError("test server exited before readiness")
                    try:
                        request(anonymous, "GET", "/api/healthz")
                        break
                    except (OSError, urllib.error.URLError):
                        time.sleep(0.1)
                else:
                    raise RuntimeError("test server did not become ready")
                request(anonymous, "GET", "/api/clusters", expected=401)
                request(admin, "POST", "/api/auth/login", {"username": "admin", "password": password})
                assert request(admin, "GET", "/api/clusters") == []
                checks.append("host kubeconfigs are not inherited")
                user = request(admin, "POST", "/api/auth/users", {"username": "reader", "password": password, "role": "user"})
                request(reader, "POST", "/api/auth/login", {"username": "reader", "password": password})
                admin_id = request(admin, "POST", "/api/clusters", config, expected=201)[0]["id"]
                assert request(reader, "GET", "/api/clusters") == []
                request(reader, "GET", f"/api/clusters/{admin_id}/pods", expected=404)
                request(reader, "DELETE", f"/api/clusters/{admin_id}", expected=404)
                checks.append("cross-user cluster access is denied")

                kubectl("create", "namespace", namespace)
                created = True
                kubectl("apply", "-f", "-", body={"apiVersion": "v1", "kind": "List", "items": [
                    {"apiVersion": "v1", "kind": "ServiceAccount", "metadata": {"name": "reader", "namespace": namespace}},
                    {"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "Role", "metadata": {"name": "reader", "namespace": namespace}, "rules": [{"apiGroups": [""], "resources": ["configmaps"], "verbs": ["get", "list"]}]},
                    {"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "RoleBinding", "metadata": {"name": "reader", "namespace": namespace}, "subjects": [{"kind": "ServiceAccount", "name": "reader", "namespace": namespace}], "roleRef": {"apiGroup": "rbac.authorization.k8s.io", "kind": "Role", "name": "reader"}},
                ]})
                reader_config = copy.deepcopy(config)
                token = kubectl("create", "token", "reader", "-n", namespace, "--duration=10m").strip()
                reader_config["users"] = [{"name": "reader", "user": {"token": token}}]
                reader_config["contexts"][0]["context"]["user"] = "reader"
                reader_id = request(reader, "POST", "/api/clusters", reader_config, expected=201)[0]["id"]
                assert reader_id != admin_id
                request(admin, "GET", f"/api/clusters/{reader_id}/pods", expected=404)
                obj = {"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": "check", "namespace": namespace}, "data": {"note": "created by admin"}}
                admin_path = f"/api/clusters/{admin_id}/resources/configmaps/{namespace}/check"
                reader_path = f"/api/clusters/{reader_id}/resources/configmaps/{namespace}/check"
                request(admin, "PATCH", admin_path, obj)
                assert request(reader, "GET", reader_path)["data"]["note"] == "created by admin"
                obj["data"]["note"] = "must not be written"
                request(reader, "PATCH", reader_path, obj, expected=403)
                request(reader, "DELETE", reader_path, expected=403)
                assert request(admin, "GET", admin_path)["data"]["note"] == "created by admin"
                checks.append("real Kubernetes read-only credentials cannot write or delete")
                request(reader, "POST", f"/api/clusters/{reader_id}/helm/install", {"name": "denied", "namespace": namespace, "dryRun": True, "values": "{}"}, expected=403)
                checks.append("Helm installs retain Kubernetes write restrictions")

                request(admin, "PATCH", "/api/extensions/cluster-notes", {"enabled": True}, expected=204)
                plugin_request = {"clusterId": reader_id, "group": "", "version": "v1", "resource": "configmaps", "namespace": namespace, "name": "check", "verb": "get"}
                assert request(reader, "POST", "/api/extensions/cluster-notes/resources", plugin_request)["data"]["note"] == "created by admin"
                plugin_request.update({"verb": "apply", "object": obj})
                request(reader, "POST", "/api/extensions/cluster-notes/resources", plugin_request, expected=403)
                request(reader, "PATCH", "/api/extensions/cluster-notes", {"enabled": False}, expected=403)
                checks.append("plugin requests retain user RBAC and admin restrictions")
                request(admin, "PATCH", "/api/auth/users", {"id": user["id"], "role": "user", "disabled": True})
                request(reader, "GET", reader_path, expected=401)
                checks.append("disabling an account revokes its live session")
                print(json.dumps({"result": "passed", "checks": checks}))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                if created:
                    kubectl("delete", "namespace", namespace, "--wait=false")


if __name__ == "__main__":
    main()
