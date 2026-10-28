import sharp from "sharp";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/icon.svg", import.meta.url));
await Promise.all([192, 512].map(size => sharp(source).resize(size, size).png().toFile(new URL(`../public/icon-${size}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))));
const maskable = Buffer.from(source.toString().replace('rx="112"', 'rx="0"'));
await sharp(maskable).png().toFile(new URL("../public/icon-maskable-512.png", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
