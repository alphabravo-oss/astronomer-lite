const { join } = require("node:path");
const { Arch } = require("builder-util");
const { assertBinary } = require("./build-server.cjs");
module.exports = async (context) => {
  const platform = context.electronPlatformName;
  const resources =
    platform === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : join(context.appOutDir, "resources");
  const binary = join(
      resources,
      "server",
      platform === "win32" ? "astronomer-lite.exe" : "astronomer-lite",
    );
  assertBinary(binary, platform, Arch[context.arch]);
};
