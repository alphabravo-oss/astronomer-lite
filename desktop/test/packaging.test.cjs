const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { assertBinary, target } = require("../build-server.cjs");

test("packager rejects an OS or CPU mismatch before shipping a bundled server", () => {
  const directory = mkdtempSync(join(tmpdir(), "lite-binary-header-"));
  try {
    const file = join(directory, "server");
    for (const arch of ["x64", "arm64"]) {
      for (const platform of ["linux", "darwin", "win32"]) {
        const header = Buffer.alloc(128);
        if (platform === "linux") {
          Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(header);
          header.writeUInt16LE(arch === "x64" ? 62 : 183, 18);
        } else if (platform === "darwin") {
          header.writeUInt32LE(0xfeedfacf);
          header.writeUInt32LE(arch === "x64" ? 0x1000007 : 0x100000c, 4);
        } else {
          header.write("MZ");
          header.writeUInt32LE(64, 60);
          header.write("PE\0\0", 64);
          header.writeUInt16LE(arch === "x64" ? 0x8664 : 0xaa64, 68);
        }
        writeFileSync(file, header);
        assert.doesNotThrow(() => assertBinary(file, platform, arch));
        assert.throws(
          () => assertBinary(file, platform, arch === "x64" ? "arm64" : "x64"),
          /Wrong bundled server/,
        );
        assert.throws(
          () =>
            assertBinary(file, platform === "linux" ? "darwin" : "linux", arch),
          /Wrong bundled server/,
        );
      }
    }
    assert.notEqual(
      target("darwin", "x64").directory,
      target("darwin", "arm64").directory,
    );
    assert.throws(() => target("linux", "ia32"), /Unsupported/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
