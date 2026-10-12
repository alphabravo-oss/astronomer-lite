import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
const result = await build({ entryPoints: ["src/runtime.jsx"], bundle: true, write: false, format: "iife", minify: true, legalComments: "eof", define: { "process.env.NODE_ENV": '"production"' } });
await mkdir("../../web/src/generated", { recursive: true });
await writeFile("../../web/src/generated/headlamp-runtime.js", result.outputFiles[0].text);
