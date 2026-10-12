const {
  app,
  BrowserWindow,
  dialog,
  Menu,
  session,
  shell,
} = require("electron");
const { join } = require("node:path");
const { mkdirSync } = require("node:fs");
const { buildMenuTemplate } = require("./menu.cjs");
const { startServer, isLocalURL } = require("./launcher.cjs");

app.setName("Astronomer Lite");
// Keep existing workspaces and preferences across the display-name change.
if (!app.commandLine.hasSwitch("user-data-dir")) {
  const profile = join(app.getPath("appData"), "Astronomer-Lite");
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
}
let window;
let server;
let stopping = false;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (!server || stopping) return;
    event.preventDefault();
    stopping = true;
    void server.stop().finally(() => app.quit());
  });
  app
    .whenReady()
    .then(async () => {
      const binary = join(
        app.isPackaged
          ? join(process.resourcesPath, "server")
          : join(
              __dirname,
              "bin",
              `${{ win32: "win", darwin: "mac", linux: "linux" }[process.platform]}-${process.arch}`,
            ),
        process.platform === "win32"
          ? "astronomer-lite.exe"
          : "astronomer-lite",
      );
      server = startServer(binary, join(app.getPath("userData"), "workspace"));
      const { origin, token } = await server.ready;
      server.child.once("exit", () => {
        if (!stopping) {
          dialog.showErrorBox(
            "Astronomer Lite stopped",
            "The local server exited. Restart the app to reconnect.",
          );
          app.quit();
        }
      });
      const ses = session.defaultSession;
      ses.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      ses.setPermissionCheckHandler(() => false);
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        // Remove the capability on every external redirect, including WebSockets.
        const headers = Object.fromEntries(
          Object.entries(details.requestHeaders).filter(
            ([key]) => key.toLowerCase() !== "x-astronomer-desktop",
          ),
        );
        if (isLocalURL(details.url, origin))
          headers["X-Astronomer-Desktop"] = token;
        callback({ requestHeaders: headers });
      });
      window = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 800,
        minHeight: 600,
        title: "Astronomer Lite",
        icon: join(__dirname, "icon.png"),
        show: false,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webviewTag: false,
          webSecurity: true,
        },
      });
      const external = async (url) => {
        let target;
        try {
          target = new URL(url);
        } catch {
          return;
        }
        if (
          !["http:", "https:"].includes(target.protocol) ||
          target.username ||
          target.password
        )
          return;
        const result = await dialog.showMessageBox(window, {
          type: "question",
          title: "Open in browser",
          message: "Open this address in your browser?",
          detail: target.href,
          buttons: ["Cancel", "Open"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) await shell.openExternal(target.href);
      };
      window.webContents.on("will-navigate", (event, url) => {
        if (!isLocalURL(url, origin)) {
          event.preventDefault();
          void external(url);
        }
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        void external(url);
        return { action: "deny" };
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(buildMenuTemplate(process.platform, {
          openSettings: () => {
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
            if (isLocalURL(window.webContents.getURL(), origin)) {
              window.webContents.send("astronomer:open-settings");
            }
          },
          showAbout: () => dialog.showMessageBox(window, {
            title: "Astronomer Lite",
            message: `Astronomer Lite ${app.getVersion()}`,
            detail: "Kubernetes workspace by AlphaBravo.",
          }),
        })),
      );
      await window.loadURL(origin);
      window.show();
    })
    .catch((error) => {
      dialog.showErrorBox("Could not start Astronomer Lite", error.message);
      app.quit();
    });
}
