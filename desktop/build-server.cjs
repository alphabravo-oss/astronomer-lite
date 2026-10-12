const { mkdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const pkg = require("./package.json");

const platforms = {
  win32: { go: "windows", folder: "win" },
  darwin: { go: "darwin", folder: "mac" },
  linux: { go: "linux", folder: "linux" },
};
const architectures = { x64: "amd64", arm64: "arm64" };
function target(platform = process.platform, arch = process.arch) {
  if (!platforms[platform] || !architectures[arch])
    throw new Error(`Unsupported desktop target: ${platform}/${arch}`);
  const directory = join(
    __dirname,
    "bin",
    `${platforms[platform].folder}-${arch}`,
  );
  return {
    platform,
    arch,
    goos: platforms[platform].go,
    goarch: architectures[arch],
    directory,
    binary: join(
      directory,
      platform === "win32" ? "astronomer-lite.exe" : "astronomer-lite",
    ),
  };
}
function assertBinary(file, platform, arch) {
  const bytes = readFileSync(file);
  let actual = "";
  if (
    bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
    bytes[4] === 2 &&
    bytes[5] === 1
  ) {
    actual = `linux/${{ 62: "x64", 183: "arm64" }[bytes.readUInt16LE(18)]}`;
  } else if (bytes.subarray(0, 2).toString() === "MZ") {
    const offset = bytes.readUInt32LE(60);
    if (bytes.subarray(offset, offset + 4).toString() === "PE\0\0")
      actual = `win32/${{ 0x8664: "x64", 0xaa64: "arm64" }[bytes.readUInt16LE(offset + 4)]}`;
  } else if (bytes.readUInt32LE(0) === 0xfeedfacf) {
    actual = `darwin/${{ 0x1000007: "x64", 0x100000c: "arm64" }[bytes.readUInt32LE(4)]}`;
  }
  if (actual !== `${platform}/${arch}`)
    throw new Error(
      `Wrong bundled server: expected ${platform}/${arch}, found ${actual || "unknown format"} in ${file}`,
    );
}
function buildServer(platform, arch) {
  const selected = target(platform, arch);
  mkdirSync(selected.directory, { recursive: true });
  execFileSync(
    "go",
    [
      "build",
      "-p",
      "4",
      "-trimpath",
      "-ldflags",
      `-s -w -X github.com/alphabravo/astronomer-lite/server/internal/version.Version=${pkg.version}`,
      "-o",
      selected.binary,
      "./cmd/astronomer-lite",
    ],
    {
      cwd: join(__dirname, "../server"),
      stdio: "inherit",
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: selected.goos,
        GOARCH: selected.goarch,
      },
    },
  );
  assertBinary(selected.binary, selected.platform, selected.arch);
  return selected.binary;
}
if (require.main === module)
  buildServer(
    process.argv[2] || process.platform,
    process.argv[3] || process.arch,
  );
module.exports = { target, buildServer, assertBinary };
