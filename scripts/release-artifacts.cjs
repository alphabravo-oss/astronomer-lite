const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { check } = require("./release-version.cjs");
const root = path.resolve(__dirname, "..");
const targets = { "linux-x64": ["linux-x86_64.AppImage", "linux-amd64.deb", "linux-x86_64.rpm"], "win-x64": ["win-x64.exe"], "mac-x64": ["mac-x64.dmg", "mac-x64.zip"], "mac-arm64": ["mac-arm64.dmg", "mac-arm64.zip"] };
function digest(file) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer))) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}
function names(current, target) {
  if (!targets[target]) throw new Error(`Unknown release target: ${target}`);
  return targets[target].map((suffix) => `Astronomer-Lite-${current}-${suffix}`);
}
function verify(directory, manifest, current, revision, signed, requireClean = signed) {
  if (requireClean && manifest.dirty !== false) throw new Error("Release drafts require a clean source checkout");
  if (manifest.version !== current || manifest.revision !== revision || manifest.signed !== signed) throw new Error("Release provenance mismatch");
  const expected = names(current, manifest.target);
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(expected.sort())) throw new Error("Unexpected or missing installer");
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (!/^[a-f0-9]{64}$/.test(hash) || digest(path.join(directory, file)) !== hash) throw new Error(`Artifact hash mismatch: ${file}`);
  }
}
function main() {
  const current = check();
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const signed = process.env.LITE_SIGNED_RELEASE === "true";
  const requireClean = signed || process.env.LITE_RELEASE_DRAFT === "true";
  const command = process.argv[2];
  if (command === "stage") {
    const target = process.argv[3];
    const directory = path.join(root, "release/artifacts", target);
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
    if (requireClean && dirty) throw new Error("Release drafts require a clean source checkout");
    for (const file of names(current, target)) fs.accessSync(path.join(root, "desktop/dist", file));
    if (fs.existsSync(directory)) throw new Error(`Refusing to mix release artifacts: remove ${directory} before staging again`);
    fs.mkdirSync(directory, { recursive: true });
    const files = {};
    for (const file of names(current, target)) {
      fs.copyFileSync(path.join(root, "desktop/dist", file), path.join(directory, file));
      files[file] = digest(path.join(directory, file));
      fs.writeFileSync(path.join(directory, `${file}.sha256`), `${files[file]}  ${file}\n`);
    }
    fs.writeFileSync(path.join(directory, `manifest-${target}.json`), `${JSON.stringify({ version: current, revision, dirty, target, signed, files }, null, 2)}\n`);
    for (const file of ["LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.txt", "dependencies.json"]) fs.copyFileSync(path.join(root, "release/generated", file), path.join(directory, `${target}-${file}`));
  } else if (command === "verify") {
    const directory = path.resolve(process.argv[3]);
    const checksums = [];
    for (const target of Object.keys(targets)) {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, `manifest-${target}.json`)));
      if (manifest.target !== target) throw new Error("Invalid release target");
      verify(directory, manifest, current, revision, signed, requireClean);
      checksums.push(...Object.entries(manifest.files).map(([file, hash]) => `${hash}  ${file}`));
    }
    fs.writeFileSync(path.join(directory, "SHA256SUMS"), `${checksums.sort().join("\n")}\n`);
    console.log(`Verified all 8 installers for ${current} at ${revision}`);
  } else throw new Error("Usage: release-artifacts.cjs stage TARGET | verify DIRECTORY");
}
if (require.main === module) main();
module.exports = { digest, names, verify };
