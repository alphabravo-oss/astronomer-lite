const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const { check } = require("../scripts/release-version.cjs");
const { Arch } = require("builder-util");
const { buildServer } = require("./build-server.cjs");
module.exports = async (context) => {
  check();
  execFileSync(process.execPath, [join(__dirname, "../scripts/third-party-notices.cjs")], { stdio: "inherit" });
  // Use the package target, never the build host or ambient GOOS/GOARCH.
  buildServer(context.electronPlatformName, Arch[context.arch]);
};
