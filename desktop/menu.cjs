function buildMenuTemplate(platform, { openSettings, showAbout }) {
  const settings = {
    id: "settings",
    label: "Settings…",
    accelerator: "CommandOrControl+,",
    click: openSettings,
  };
  const about = { label: "About Astronomer Lite", click: showAbout };
  const mac = platform === "darwin";
  return [
    ...(mac ? [{
      label: "Astronomer Lite",
      submenu: [
        about,
        { type: "separator" },
        settings,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    mac ? { role: "fileMenu" } : {
      label: "File",
      submenu: [settings, { type: "separator" }, { role: "quit" }],
    },
    { role: "editMenu" },
    { label: "View", submenu: [
      { role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" },
      { role: "zoomOut" }, { role: "togglefullscreen" },
    ] },
    { role: "windowMenu" },
    { label: "Help", submenu: [about] },
  ];
}
module.exports = { buildMenuTemplate };
