const { signing } = require("../scripts/release-preflight.cjs");
const config = structuredClone(require("./package.json").build);
const signed = process.platform === "linux" ? process.env.LITE_SIGNED_RELEASE === "true" : signing(process.platform);
config.forceCodeSigning = signed && process.platform !== "linux";
if (signed && process.platform === "darwin") {
  config.mac.binaries = ["Contents/Resources/server/astronomer-lite"];
  config.mac.notarize = true;
  config.dmg = { ...config.dmg, sign: true };
} else {
  config.mac.identity = null;
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
