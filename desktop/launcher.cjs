const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { createInterface } = require("node:readline");

function startServer(binary, configDir) {
  const token = randomBytes(32).toString("hex");
  const portFile = require("node:path").join(configDir, "desktop-port");
  const fs = require("node:fs");
  const pluginsDir = require("node:path").join(configDir, "plugins");
  if (process.env.ASTRONOMER_LITE_PLUGINS_ENABLED === "true")
    fs.mkdirSync(pluginsDir, { recursive: true, mode: 0o700 });
  let preferredPort = 0;
  try {
    const value = Number(fs.readFileSync(portFile, "utf8"));
    if (Number.isInteger(value) && value >= 1024 && value <= 65535)
      preferredPort = value;
  } catch {
    /* First launch. */
  }
  let stopping = false;
  // Preserve PATH and kubeconfig for trusted local cloud credential helpers.
  // Deployment settings from a shell must not turn the desktop into a server.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("ASTRONOMER_LITE_"),
    ),
  );
  Object.assign(env, {
    ASTRONOMER_LITE_HOST: "127.0.0.1",
    ASTRONOMER_LITE_AUTH_MODE: "single-user",
    ASTRONOMER_LITE_CONFIG_DIR: configDir,
    ASTRONOMER_LITE_DESKTOP_TOKEN: token,
  });
  env.ASTRONOMER_LITE_PLUGINS_DIR = pluginsDir;
  for (const key of [
    "ASTRONOMER_LITE_PLUGINS_ENABLED",
    "ASTRONOMER_LITE_PLUGIN_CATALOG_URL",
    "ASTRONOMER_LITE_PLUGIN_TRUST_KEY_FILE",
  ])
    if (process.env[key]) env[key] = process.env[key];
  function launch(port) {
    const child = spawn(binary, [], {
      env: { ...env, PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.stdin.end();
        reject(new Error("Local server did not start within 30 seconds"));
      }, 30_000);
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (!line.startsWith("ASTRONOMER_LITE_READY=")) return;
        try {
          const origin = new URL(line.slice("ASTRONOMER_LITE_READY=".length));
          if (
            origin.protocol !== "http:" ||
            origin.hostname !== "127.0.0.1" ||
            !origin.port ||
            origin.pathname !== "/"
          )
            throw new Error("Invalid local server address");
          // A stable origin preserves theme, table and navigation preferences.
          try {
            fs.writeFileSync(portFile, origin.port, { mode: 0o600 });
          } catch {
            /* State remains usable for this launch. */
          }
          clearTimeout(timer);
          resolve({ origin: origin.origin, token });
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Local server exited before it was ready"));
      });
    });
    child.stderr.resume();
    return { child, ready };
  }
  function stopChild(child) {
    return new Promise((resolve) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null)
        return resolve();
      const timer = setTimeout(() => child.kill("SIGKILL"), 12_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      // EOF also shuts down the server after an unexpected launcher crash.
      child.stdin.end();
    });
  }
  let running = launch(preferredPort);
  const ready = running.ready.catch(async (error) => {
    if (!preferredPort || stopping) throw error;
    await stopChild(running.child);
    if (stopping) throw error;
    // Another application may have claimed the previous port. Never connect to it.
    running = launch(0);
    return running.ready;
  });
  return {
    get child() {
      return running.child;
    },
    ready,
    stop: () => {
      stopping = true;
      return stopChild(running.child);
    },
  };
}

function isLocalURL(value, origin) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "ws:") &&
      url.host === new URL(origin).host &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
module.exports = { startServer, isLocalURL };
