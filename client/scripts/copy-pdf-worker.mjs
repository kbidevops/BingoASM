// Copies the pdf.js worker into public/ so the static export can load it (floor plan PDF import).
// Saved as .js so any server (Spring included) sends a JavaScript MIME type, which module workers require.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.js");
