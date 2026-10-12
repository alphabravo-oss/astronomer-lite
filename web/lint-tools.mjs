import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const eslint = new ESLint({
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  overrideConfigFile: fileURLToPath(
    new URL("./eslint.tools.config.js", import.meta.url),
  ),
});
const results = await eslint.lintFiles([
  "desktop/**/*.cjs",
  "scripts/*.{cjs,mjs}",
  "compat/headlamp/build.mjs",
  "compat/headlamp/src/**/*.jsx",
]);
const formatter = await eslint.loadFormatter("stylish");
const output = formatter.format(results);
if (output) process.stdout.write(output);
if (results.some((result) => result.errorCount || result.warningCount))
  process.exitCode = 1;
