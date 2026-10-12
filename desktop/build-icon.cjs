const { Resvg } = require("@resvg/resvg-js");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
writeFileSync(
  join(__dirname, "icon.png"),
  new Resvg(readFileSync(join(__dirname, "../web/public/favicon.svg")), {
    fitTo: { mode: "width", value: 512 },
  })
    .render()
    .asPng(),
);
