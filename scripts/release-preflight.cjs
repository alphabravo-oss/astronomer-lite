const { check } = require("./release-version.cjs");
function required(env, names) {
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing release configuration: ${missing.join(", ")}`);
}
function signing(platform, env = process.env) {
  if (env.LITE_SIGNED_RELEASE !== "true") return false;
  if (platform === "darwin") required(env, ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]);
  else if (platform === "win32") required(env, ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_SIGNING_ENDPOINT", "AZURE_SIGNING_ACCOUNT", "AZURE_SIGNING_PROFILE", "WINDOWS_PUBLISHER_NAME"]);
  else if (platform === "linux") required(env, ["RPM_SIGNING_KEY_BASE64", "RPM_SIGNING_FINGERPRINT", "RPM_SIGNING_PASSPHRASE"]);
  else throw new Error(`Unsupported signing platform: ${platform}`);
  return true;
}
if (require.main === module) {
  const current = check();
  const ref = process.env.GITHUB_REF || "";
  if (ref.startsWith("refs/tags/") && ref !== `refs/tags/v${current}`) throw new Error("Tag must equal v + VERSION");
  signing(process.platform);
  console.log(`Release metadata valid: ${current}; signing ${process.env.LITE_SIGNED_RELEASE === "true" ? "required" : "disabled"}`);
}
module.exports = { signing };
