#!/usr/bin/env python3
"""Run an isolated real Dex identity provider and Lite for the OIDC browser suite."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
# Pinned official release, pulled explicitly by the test runner.
DEX_IMAGE = "ghcr.io/dexidp/dex:v2.43.0@sha256:b08a58c9731c693b8db02154d7afda798e1888dc76db30d34c4a0d0b8a26d913"
PASSWORD = "test-only-password-1234"
PASSWORD_HASH = "$2b$10$o0KCJOHaf58BasrqTEf5TeKzflVEYXcG78yIETOi0GAszWKnFybr6"

def stop(_signal, _frame):
    raise KeyboardInterrupt()

def main():
    signal.signal(signal.SIGTERM, stop)
    with tempfile.TemporaryDirectory(prefix="lite-oidc-e2e-") as folder:
        directory = Path(folder)
        config = {
            "issuer": "http://127.0.0.1:18085/dex",
            "storage": {"type": "memory"},
            "web": {"http": "0.0.0.0:5556"},
            "oauth2": {"skipApprovalScreen": True},
            "expiry": {"idTokens": "20s"},
            "staticClients": [{"id": "lite-test", "secret": "test-only-client-secret", "name": "Astronomer-Lite", "redirectURIs": ["http://127.0.0.1:18086/api/auth/oidc/callback"]}],
            "enablePasswordDB": True,
            "staticPasswords": [{"email": "operator@example.test", "hash": PASSWORD_HASH, "username": "oidc-operator", "userID": "stable-test-identity"}],
        }
        dex_file = directory / "dex.json"
        dex_file.write_text(json.dumps(config))
        dex_file.chmod(0o444)
        bootstrap = directory / "bootstrap"
        bootstrap.write_text(PASSWORD)
        bootstrap.chmod(0o600)
        secret = directory / "client-secret"
        secret.write_text("test-only-client-secret")
        secret.chmod(0o600)
        name = "lite-oidc-e2e-" + str(os.getpid())
        container = None
        process = None
        try:
            container = subprocess.check_output([
                "docker", "run", "-d", "--name", name,
                "-p", "127.0.0.1:18085:5556", "--tmpfs", "/tmp:rw,nosuid,nodev",
                "--mount", f"type=bind,src={dex_file},dst=/etc/dex/config.json,readonly",
                DEX_IMAGE, "dex", "serve", "/etc/dex/config.json",
            ], text=True).strip()
            for _ in range(60):
                try:
                    urllib.request.urlopen("http://127.0.0.1:18085/dex/.well-known/openid-configuration", timeout=1).close()
                    break
                except OSError:
                    time.sleep(0.25)
            else:
                raise RuntimeError("Dex did not become ready")
            env = dict(os.environ,
                PORT="18086", ASTRONOMER_LITE_AUTH_MODE="server",
                ASTRONOMER_LITE_CONFIG_DIR=str(directory / "state"),
                ASTRONOMER_LITE_PUBLIC_URL="http://127.0.0.1:18086",
                ASTRONOMER_LITE_ADMIN_USER="admin",
                ASTRONOMER_LITE_ADMIN_PASSWORD_FILE=str(bootstrap),
                ASTRONOMER_LITE_OIDC_ISSUER="http://127.0.0.1:18085/dex",
                ASTRONOMER_LITE_OIDC_CLIENT_ID="lite-test",
                ASTRONOMER_LITE_OIDC_CLIENT_SECRET_FILE=str(secret),
                ASTRONOMER_LITE_OIDC_REFRESH="true",
                ASTRONOMER_LITE_OIDC_ADMIN_GROUPS="", ASTRONOMER_LITE_OIDC_REQUIRED_GROUPS="",
                ASTRONOMER_LITE_PLUGINS_DIR="",
            )
            process = subprocess.Popen([str(ROOT / "server/bin/astronomer-lite")], env=env)
            process.wait()
        except KeyboardInterrupt:
            pass
        finally:
            if process:
                process.terminate()
                try: process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            if container:
                subprocess.run(["docker", "rm", "-f", container], check=False, stdout=subprocess.DEVNULL)

if __name__ == "__main__":
    main()
