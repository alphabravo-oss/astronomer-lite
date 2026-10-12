const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { version, check } = require("./release-version.cjs");
const { signing } = require("./release-preflight.cjs");
const { digest, names, verify } = require("./release-artifacts.cjs");

test("release version rejects malformed tags and command/path characters", () => {
  for (const value of ["0.2.0", "0.2.0-rc.1"]) assert.equal(version(value), value);
  for (const value of ["v0.2.0", "01.2.0", "0.2.0-rc.01", "../../0.2.0", "0.2.0\n", "0.2.0; echo bad"]) assert.throws(() => version(value));
});
test("metadata gate catches package and license drift", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lite-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "VERSION"), "0.2.0\n");
  for (const dir of ["web", "desktop", "compat/headlamp"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    const pkg = { version: "0.2.0", license: "Apache-2.0" };
    fs.writeFileSync(path.join(root, dir, "package.json"), JSON.stringify(pkg));
    fs.writeFileSync(path.join(root, dir, "package-lock.json"), JSON.stringify({ version: pkg.version, packages: { "": pkg } }));
  }
  fs.mkdirSync(path.join(root, "release/notes"), { recursive: true });
  fs.writeFileSync(path.join(root, "release/notes/0.2.0.md"), "Release notes. ".repeat(20));
  assert.equal(check(root), "0.2.0");
  fs.writeFileSync(path.join(root, "desktop/package.json"), JSON.stringify({ version: "0.1.0", license: "Apache-2.0" }));
  assert.throws(() => check(root), /version differs/);
  fs.writeFileSync(path.join(root, "desktop/package.json"), JSON.stringify({ version: "0.2.0", license: "UNLICENSED" }));
  assert.throws(() => check(root), /Apache-2.0/);
});
test("signing cannot silently fall back when credentials are missing", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    assert.equal(signing(platform, {}), false);
    assert.throws(() => signing(platform, { LITE_SIGNED_RELEASE: "true" }), /Missing release configuration/);
  }
  assert.throws(() => signing("unknown", { LITE_SIGNED_RELEASE: "true" }), /Unsupported/);
});
test("artifact verification rejects tampering, mixed commits, wrong signing state and paths", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lite-artifacts-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = names("0.2.0", "win-x64")[0];
  fs.writeFileSync(path.join(directory, file), "fixture installer");
  const manifest = { version: "0.2.0", revision: "abc", signed: false, dirty: false, target: "win-x64", files: { [file]: digest(path.join(directory, file)) } };
  verify(directory, manifest, "0.2.0", "abc", false);
  verify(directory, manifest, "0.2.0", "abc", false, true);
  assert.throws(() => verify(directory, { ...manifest, dirty: true }, "0.2.0", "abc", false, true), /clean source/);
  assert.throws(() => verify(directory, { ...manifest, dirty: undefined }, "0.2.0", "abc", false, true), /clean source/);
  assert.throws(() => verify(directory, manifest, "0.2.0", "def", false), /provenance/);
  assert.throws(() => verify(directory, manifest, "0.2.0", "abc", true), /provenance/);
  assert.throws(() => verify(directory, { ...manifest, files: { "../secret": "a".repeat(64) } }, "0.2.0", "abc", false), /installer/);
  fs.writeFileSync(path.join(directory, file), "changed installer");
  assert.throws(() => verify(directory, manifest, "0.2.0", "abc", false), /hash mismatch/);
});
