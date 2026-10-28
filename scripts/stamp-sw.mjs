import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const file = new URL("../public/sw.js", import.meta.url);
const source = await readFile(file, "utf8");
await writeFile(file, source.replace(/^const BUILD = "[^"]+";/m, `const BUILD = "${randomUUID()}";`));
