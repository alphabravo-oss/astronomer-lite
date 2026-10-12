const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { startServer, isLocalURL } = require("../launcher.cjs");

test("capability is restricted to the exact local HTTP/WebSocket endpoint", () => {
  const origin = "http://127.0.0.1:1234";
  for (const value of [
    `${origin}/api/clusters`,
    "ws://127.0.0.1:1234/api/exec",
  ])
    assert.ok(isLocalURL(value, origin));
  for (const value of [
    "http://127.0.0.1:1235",
    "https://127.0.0.1:1234",
    "http://127.0.0.1.evil:1234",
    "file:///etc/passwd",
    "http://a:b@127.0.0.1:1234",
  ])
    assert.equal(isLocalURL(value, origin), false);
});

test(
  "real server is private, locks its workspace and stops on launcher EOF",
  { timeout: 30_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "lite-desktop-test-"));
    const binary = require("../build-server.cjs").target().binary;
    let first, second;
    try {
      first = startServer(binary, directory);
      const { origin, token } = await first.ready;
      assert.equal((await fetch(`${origin}/api/healthz`)).status, 401);
      assert.equal(
        (
          await fetch(`${origin}/api/healthz`, {
            headers: { "X-Astronomer-Desktop": token },
          })
        ).status,
        200,
      );
      const response = await fetch(`${origin}/api/auth/session`, {
        headers: { "X-Astronomer-Desktop": token },
      });
      const session = await response.json();
      assert.equal(session.mode, "single-user");
      assert.equal(session.plugins, process.env.ASTRONOMER_LITE_PLUGINS_ENABLED === "true");
      second = startServer(binary, directory);
      await assert.rejects(second.ready, /exited before/);
      await first.stop();
      await assert.rejects(
        fetch(`${origin}/api/healthz`, { signal: AbortSignal.timeout(2000) }),
      );
      first = startServer(binary, directory);
      const restarted = await first.ready; // OS lock was released and stale lock files do not block restart.
      assert.equal(restarted.origin, origin);
      assert.notEqual(restarted.token, token);
    } finally {
      if (first) await first.stop();
      if (second) await second.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
