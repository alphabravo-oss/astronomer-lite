const { contextBridge, ipcRenderer } = require("electron");

// A one-way native menu notification; renderer code receives no IPC or Node access.
contextBridge.exposeInMainWorld("astronomerDesktop", {
  onOpenSettings(callback) {
    const listener = () => callback();
    ipcRenderer.on("astronomer:open-settings", listener);
    return () => ipcRenderer.removeListener("astronomer:open-settings", listener);
  },
});
