// Conservative inventory of production npm dependencies and Go modules used on
// supported desktop platforms. Keep original texts; never infer a new license.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "release/generated");
const entries = new Map();
const sources = require("../release/licenses/sources.json");
function licenseFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) return licenseFiles(path.join(directory, entry.name), path.join(prefix, entry.name));
    return entry.isFile() && /^(licen[cs]e|copying|notice|ofl)([.-]|$)/i.test(entry.name) ? [path.join(prefix, entry.name)] : [];
  });
}
function add(name, version, directory, license = "See original license text") {
  const id = `${name}@${version}`;
  if (entries.has(id)) return;
  const files = licenseFiles(directory);
  const texts = files.sort().map((file) => ({ file, text: fs.readFileSync(path.join(directory, file), "utf8") }));
  if (sources[id]) texts.push({ file: sources[id].source, text: fs.readFileSync(path.join(root, "release/licenses", sources[id].file), "utf8") });
  if (!texts.length) throw new Error(`No license text found for ${id} in ${directory}; review before distributing`);
  entries.set(id, { name, version, license, texts });
}
for (const project of ["web", "compat/headlamp"]) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, project, "package-lock.json")));
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location || entry.dev) continue;
    const directory = path.join(root, project, location);
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
    add(pkg.name, pkg.version, directory, pkg.license);
  }
}
const go = (args, env = {}) => execFileSync("go", args, { cwd: path.join(root, "server"), encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 }).trim();
for (const GOOS of ["linux", "darwin", "windows"]) {
  const modules = go(["list", "-deps", "-f", "{{if .Module}}{{if not .Module.Main}}{{.Module.Path}}|{{.Module.Version}}|{{.Module.Dir}}{{end}}{{end}}", "./cmd/astronomer-lite"], { GOOS, GOARCH: "amd64", CGO_ENABLED: "0" });
  for (const line of new Set(modules.split("\n").filter(Boolean))) {
    const [name, version, directory] = line.split("|");
    add(name, version, directory);
  }
}
add("Go standard library", go(["env", "GOVERSION"]), go(["env", "GOROOT"]), "BSD-3-Clause");
const sorted = [...entries.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "THIRD-PARTY-NOTICES.txt"), sorted.map(({ name, version, license, texts }) => `===== ${name}@${version} (${license}) =====\n\n${texts.map(({ file, text }) => `--- ${file} ---\n${text}`).join("\n\n")}`).join("\n\n"));
fs.writeFileSync(path.join(out, "dependencies.json"), `${JSON.stringify({ scope: "Production npm dependencies and Go modules used by supported desktop targets; conservative inventory, not a complete OS/Electron SBOM. Electron/Chromium notices ship separately with Electron.", components: sorted.map(({ name, version, license, texts }) => ({ name, version, license, notices: texts.map(({ file }) => file) })) }, null, 2)}\n`);
for (const file of ["LICENSE", "NOTICE"]) fs.copyFileSync(path.join(root, file), path.join(out, file));
console.log(`Preserved notices for ${sorted.length} dependencies in release/generated`);
