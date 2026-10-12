import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = process.argv[2];
if (!root) throw new Error("Temporary fixture directory required");
const publisher = join(dirname(fileURLToPath(import.meta.url)), "package-plugin.mjs");
const keys = join(root, "publisher-keys"); const source = join(root, "catalog-source"); const catalog = join(root, "catalog");
mkdirSync(source, { recursive: true }); mkdirSync(catalog, { recursive: true });
execFileSync(process.execPath, [publisher, "keygen", keys]);
const packages = [];
for (const version of ["1.0.0", "1.1.0"]) {
 writeFileSync(join(source, "plugin.json"), JSON.stringify({ id: "catalog-fixture", name: "Catalog fixture", version, entry: "index.html", description: "Signed browser test fixture", permissions: [{ group: "", resource: version === "1.0.0" ? "namespaces" : "pods", verbs: ["list"] }] }));
 writeFileSync(join(source, "index.html"), `<h1>Catalog fixture ${version}</h1>`);
 const output = join(catalog, `fixture-${version}.json`); packages.push(output);
 execFileSync(process.execPath, [publisher, "package", source, join(keys, "publisher.pem"), output]);
}
execFileSync(process.execPath, [publisher, "catalog", "http://127.0.0.1:18084/", join(keys, "publisher.pem"), join(catalog, "index.json"), ...packages]);
