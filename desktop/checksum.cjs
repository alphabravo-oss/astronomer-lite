const { createReadStream } = require("node:fs");
const { writeFile } = require("node:fs/promises");
const { basename } = require("node:path");
const { createHash } = require("node:crypto");
module.exports = async ({ file }) => {
  if (!file || !/\.(AppImage|deb|rpm|dmg|zip|exe)$/.test(file)) return;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  await writeFile(
    `${file}.sha256`,
    `${hash.digest("hex")}  ${basename(file)}\n`,
  );
};
