import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const destination = join("dist", "saramin-notion-extractor");
const files = [
  "background.js", "content.js", "core.js", "workflow.js", "manifest.json",
  "popup.html", "popup.css", "popup.js", "offscreen.html", "offscreen.js", "ocr"
];

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const file of files) cpSync(file, join(destination, file), { recursive: true });
