import { mkdir, writeFile } from "node:fs/promises";

await mkdir(".vercel-static", { recursive: true });
await writeFile(
  ".vercel-static/index.html",
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>Pino Forte</title></head><body></body></html>\n",
);
