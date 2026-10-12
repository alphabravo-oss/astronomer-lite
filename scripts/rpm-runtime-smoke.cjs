// Run using the packaged Electron's Node mode inside a disposable Red Hat UBI.
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { startServer } = require('/opt/Astronomer Lite/resources/app.asar/launcher.cjs');
(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-rpm-'));
  let server;
  try {
    server = startServer('/opt/Astronomer Lite/resources/server/astronomer-lite', directory);
    const { origin, token } = await server.ready;
    assert.equal((await fetch(`${origin}/api/clusters`)).status, 401);
    const response = await fetch(`${origin}/api/auth/session`, { headers: { 'X-Astronomer-Desktop': token } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).mode, 'single-user');
    await server.stop();
    await assert.rejects(fetch(`${origin}/api/healthz`, { signal: AbortSignal.timeout(2000) }));
    console.log(JSON.stringify({ result: 'passed', electron: process.versions.electron, platform: process.platform, arch: process.arch, privateAPI: true, childShutdown: true }));
  } finally { if (server) await server.stop(); await rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
