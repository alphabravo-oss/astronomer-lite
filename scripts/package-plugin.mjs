#!/usr/bin/env node
// Offline publisher tool. Private keys never belong in the Lite deployment.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [command, ...args] = process.argv.slice(2);
function signed(value, key) {
 const payload = Buffer.from(JSON.stringify(value));
 return Buffer.from(JSON.stringify({ payload: payload.toString("base64"), signature: sign(null, payload, key).toString("base64") }));
}
if (command === "keygen" && args.length === 1) {
 mkdirSync(args[0], { recursive: true, mode: 0o700 });
 const { privateKey, publicKey } = generateKeyPairSync("ed25519");
 writeFileSync(join(args[0], "publisher.pem"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
 const raw = publicKey.export({ format: "jwk" }).x;
 writeFileSync(join(args[0], "publisher.pub"), Buffer.from(raw, "base64url").toString("base64") + "\n", { mode: 0o644, flag: "wx" });
} else if (command === "package" && args.length === 3) {
 const [directory, keyFile, output] = args;
 const manifest = JSON.parse(readFileSync(join(directory, "plugin.json"), "utf8"));
 if (manifest.entry !== "index.html") throw new Error("Package entry must be index.html");
 const html = readFileSync(join(directory, "index.html"), "utf8");
 if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Error("Plugin exceeds 2 MiB");
 writeFileSync(output, signed({ manifest, html }, createPrivateKey(readFileSync(keyFile))), { mode: 0o644 });
} else if (command === "headlamp" && args.length === 3) {
 const [bundle, manifestFile, output] = args;
 const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
 manifest.runtime = "headlamp-v1"; manifest.entry = "index.html";
 const js = readFileSync(bundle, "utf8");
 if (Buffer.byteLength(js) > 2 * 1024 * 1024 - 100) throw new Error("Headlamp plugin bundle exceeds package limit");
 mkdirSync(output, { recursive: true, mode: 0o700 });
 writeFileSync(join(output, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
 writeFileSync(join(output, "index.html"), `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`);
} else if (command === "catalog" && args.length >= 4) {
 const [baseURL, keyFile, output, ...packages] = args;
 const key = createPrivateKey(readFileSync(keyFile));
 const listings = packages.map((file) => {
  const bytes = readFileSync(file); const envelope = JSON.parse(bytes);
  const payload = Buffer.from(envelope.payload, "base64");
  if (!verify(null, payload, createPublicKey(key), Buffer.from(envelope.signature, "base64"))) throw new Error(`Package signature does not match publisher: ${file}`);
  return { manifest: JSON.parse(payload).manifest, url: new URL(basename(file), baseURL.endsWith("/") ? baseURL : baseURL + "/").href, sha256: createHash("sha256").update(bytes).digest("hex") };
 });
 writeFileSync(output, signed({ version: 1, packages: listings }, key), { mode: 0o644 });
} else {
 console.error("Usage:\n  package-plugin.mjs keygen DIRECTORY\n  package-plugin.mjs package PLUGIN_DIR PRIVATE_KEY OUTPUT\n  package-plugin.mjs headlamp MAIN_JS MANIFEST OUTPUT_DIR\n  package-plugin.mjs catalog BASE_URL PRIVATE_KEY OUTPUT PACKAGE...");
 process.exitCode = 2;
}
