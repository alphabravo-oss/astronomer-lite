const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildMenuTemplate } = require("../menu.cjs");

for (const platform of ["darwin", "win32", "linux"]) {
  test(`${platform}: Settings is in the platform menu with the standard shortcut`, () => {
    let opened = 0;
    const template = buildMenuTemplate(platform, {
      openSettings: () => opened++, showAbout: () => {},
    });
    const parent = template.find((item) => item.label === (platform === "darwin" ? "Astronomer Lite" : "File"));
    const settings = parent.submenu.find((item) => item.id === "settings");
    assert.equal(settings.label, "Settings…");
    assert.equal(settings.accelerator, "CommandOrControl+,");
    settings.click();
    assert.equal(opened, 1);
    assert.ok(parent.submenu.some((item) => item.role === "quit"));
    assert.equal(template.flatMap((item) => item.submenu ?? []).filter((item) => item.id === "settings").length, 1);
  });
}
