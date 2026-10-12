#!/usr/bin/env python3
"""Bounded Lite load test: independent contexts sharing one explicitly selected k3d API."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import copy
import itertools
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kubeconfig", required=True)
    parser.add_argument("--contexts", type=int, default=20)
    parser.add_argument("--objects", type=int, default=1000)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--duration", type=int, default=120)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if not 1 <= args.contexts <= 100 or not 1 <= args.objects <= 10000 or not 1 <= args.concurrency <= 32 or not 10 <= args.duration <= 3600:
        raise SystemExit("Bounds: contexts 1–100, objects 1–10000, concurrency 1–32, duration 10–3600 seconds")
    root = Path(__file__).resolve().parent.parent
    kubeconfig = str(Path(args.kubeconfig).resolve())

    def kubectl(*argv, body=None):
        return subprocess.check_output(["kubectl", "--kubeconfig", kubeconfig, *argv], input=None if body is None else json.dumps(body), text=True, stderr=subprocess.PIPE)

    source = json.loads(kubectl("config", "view", "--raw", "--minify", "-o", "json"))
    if not source["current-context"].startswith("k3d-"):
        raise SystemExit("An explicit k3d context is required; this creates only a temporary namespace there")
    namespace = "lite-soak-" + secrets.token_hex(4)
    with tempfile.TemporaryDirectory(prefix="lite-soak-") as folder:
        folder = Path(folder)
        process = None
        try:
            kubectl("create", "namespace", namespace)
            objects = [{"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": f"sample-{i:05d}", "namespace": namespace}, "data": {"value": "x" * 256}} for i in range(args.objects)]
            kubectl("create", "-f", "-", body={"apiVersion": "v1", "kind": "List", "items": objects})
            config = copy.deepcopy(source)
            config["contexts"] = [{"name": f"soak-{i:03d}", "context": copy.deepcopy(source["contexts"][0]["context"])} for i in range(args.contexts)]
            config["current-context"] = "soak-000"
            private_config = folder / "kubeconfig"
            private_config.write_text(json.dumps(config)); private_config.chmod(0o600)
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0)); port = listener.getsockname()[1]
            env = {k: v for k, v in os.environ.items() if not k.startswith("ASTRONOMER_LITE_")}
            env.update(PORT=str(port), KUBECONFIG=str(private_config), ASTRONOMER_LITE_CONFIG_DIR=str(folder / "state"), ASTRONOMER_LITE_HOST="127.0.0.1", ASTRONOMER_LITE_AUTH_MODE="single-user")
            with (folder / "server.log").open("w") as log:
                process = subprocess.Popen([str(root / "server/bin/astronomer-lite")], env=env, stdout=log, stderr=log)
                origin = f"http://127.0.0.1:{port}"

                def get(path):
                    with urllib.request.urlopen(origin + path, timeout=30) as response:
                        return json.load(response)

                for _ in range(120):
                    try:
                        clusters = get("/api/clusters")
                        if len(clusters) == args.contexts and all(c["reachable"] for c in clusters):
                            break
                    except OSError:
                        pass
                    time.sleep(0.5)
                else:
                    raise RuntimeError("Soak contexts did not become ready")
                paths = []
                for cluster in clusters:
                    prefix = "/api/clusters/" + cluster["id"]
                    paths.extend([prefix + "/resources/configmaps?namespace=" + namespace, prefix + "/pods?namespace=kube-system", prefix + "/topology?namespace=" + namespace, prefix + "/namespaces"])
                # Warm every independent client/informer set before measuring.
                with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
                    list(pool.map(get, paths))

                def rss():
                    for line in Path(f"/proc/{process.pid}/status").read_text().splitlines():
                        if line.startswith("VmRSS:"):
                            return int(line.split()[1]) * 1024
                    return 0

                baseline = rss(); peak = baseline; latencies = []; errors = []
                lock = threading.Lock(); counter = itertools.count(); deadline = time.monotonic() + args.duration

                def worker():
                    nonlocal peak
                    while time.monotonic() < deadline:
                        index = next(counter); path = paths[index % len(paths)]; start = time.monotonic()
                        try:
                            result = get(path)
                            if "/resources/configmaps" in path and sum(item["name"].startswith("sample-") for item in result["items"]) != args.objects:
                                raise RuntimeError("Resource inventory was truncated")
                            elapsed = (time.monotonic() - start) * 1000
                            memory = rss()
                            with lock:
                                latencies.append(elapsed); peak = max(peak, memory)
                        except Exception as error:
                            with lock:
                                errors.append(type(error).__name__)
                        time.sleep(0.05)

                with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
                    list(pool.map(lambda _: worker(), range(args.concurrency)))
                latencies.sort()
                percentile = lambda p: round(latencies[min(len(latencies) - 1, int(len(latencies) * p))], 2) if latencies else None
                report = {"result": "passed" if not errors else "failed", "model": "independent contexts sharing one physical k3d cluster; not a production fleet benchmark", "kubernetes": clusters[0].get("version"), "contexts": args.contexts, "configmaps": args.objects, "concurrency": args.concurrency, "durationSeconds": args.duration, "requests": len(latencies), "errors": errors[:20], "errorCount": len(errors), "latencyMs": {"p50": percentile(.5), "p95": percentile(.95), "p99": percentile(.99)}, "rssBytes": {"afterWarmup": baseline, "peak": peak, "final": rss()}}
                Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
                print(json.dumps(report))
                if errors:
                    raise SystemExit(1)
        finally:
            if process:
                process.terminate()
                try: process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
            kubectl("delete", "namespace", namespace, "--ignore-not-found", "--wait=false")


if __name__ == "__main__":
    main()
