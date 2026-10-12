const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const packages = ["web", "desktop", "compat/headlamp"];
function version(value) {
  if (typeof value !== "string" || value.trim() !== value || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(value)) {
    throw new Error("Version must be X.Y.Z or X.Y.Z-{alpha,beta,rc}.N with no leading zeros");
  }
  return value;
}
function check(base = root) {
  const current = version(fs.readFileSync(path.join(base, "VERSION"), "utf8").trim());
  for (const dir of packages) {
    const pkg = JSON.parse(fs.readFileSync(path.join(base, dir, "package.json")));
    const lock = JSON.parse(fs.readFileSync(path.join(base, dir, "package-lock.json")));
    for (const entry of [pkg, lock, lock.packages[""]]) {
      if (entry.version !== current) throw new Error(`${dir}: version differs from VERSION (${current})`);
    }
    for (const entry of [pkg, lock.packages[""]]) {
      if (entry.license !== "Apache-2.0") throw new Error(`${dir}: expected Apache-2.0 license`);
    }
  }
  const notes = path.join(base, "release", "notes", `${current}.md`);
  if (!fs.existsSync(notes) || fs.readFileSync(notes, "utf8").trim().length < 100) throw new Error(`Missing release notes: ${notes}`);
  return current;
}
function set(value) {
  version(value);
  for (const dir of packages) {
    for (const file of ["package.json", "package-lock.json"]) {
      const filename = path.join(root, dir, file);
      const pkg = JSON.parse(fs.readFileSync(filename));
      pkg.version = value;
      if (file === "package.json") pkg.license = "Apache-2.0";
      else Object.assign(pkg.packages[""], { version: value, license: "Apache-2.0" });
      fs.writeFileSync(filename, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  }
  fs.writeFileSync(path.join(root, "VERSION"), `${value}\n`);
}
if (require.main === module) {
  if (process.argv[2] === "set") set(process.argv[3]);
  else if (process.argv[2] && process.argv[2] !== "check") throw new Error("Usage: release-version.cjs [check|set VERSION]");
  else console.log(check());
}
module.exports = { check, version };
