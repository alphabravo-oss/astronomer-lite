const { signing } = require("../scripts/release-preflight.cjs");
const { join } = require("node:path");
const config = structuredClone(require("./package.json").build);
config.mac.extraDistFiles = ["READ ME FIRST.txt"];
config.dmg = {
  backgroundColor: "#f8fafc",
  window: { width: 560, height: 440 },
  iconSize: 96,
  iconTextSize: 13,
  contents: [
    { x: 150, y: 150, type: "file" },
    { x: 410, y: 150, type: "link", path: "/Applications" },
    { x: 280, y: 330, type: "file", path: join(__dirname, "READ ME FIRST.txt") },
  ],
};
const signed = process.platform === "linux" ? process.env.LITE_SIGNED_RELEASE === "true" : signing(process.platform);
if (!signed) {
  // electron-builder treats an empty CSC_LINK as a path to the current directory.
  // Candidate builds must not import production certificates, including ambient ones.
  for (const name of ["CSC_LINK", "CSC_KEY_PASSWORD", "CSC_NAME", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"]) delete process.env[name];
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
}
config.forceCodeSigning = signed && process.platform !== "linux";
if (process.platform === "darwin") config.mac.binaries = ["Contents/Resources/server/astronomer-lite"];
if (signed && process.platform === "darwin") {
  config.mac.notarize = true;
  config.dmg = { ...config.dmg, sign: true };
} else {
  // Local signatures keep the modified app bundle runnable without a paid identity.
  // The bundled Electron entitlements retain hardened runtime with JIT support.
  config.mac.identity = process.platform === "darwin" ? "-" : null;
  config.mac.notarize = false;
}
if (signed && process.platform === "win32") {
  config.win.azureSignOptions = {
    publisherName: process.env.WINDOWS_PUBLISHER_NAME,
    endpoint: process.env.AZURE_SIGNING_ENDPOINT,
    certificateProfileName: process.env.AZURE_SIGNING_PROFILE,
    codeSigningAccountName: process.env.AZURE_SIGNING_ACCOUNT,
  };
}
module.exports = config;
