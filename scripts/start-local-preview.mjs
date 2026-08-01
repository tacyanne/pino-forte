import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ||= value;
  }
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function staticFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  if (decoded.includes("\0")) return null;
  const candidate = path.resolve(root, "dist", "client", `.${decoded}`);
  const clientRoot = path.resolve(root, "dist", "client");
  if (!candidate.startsWith(`${clientRoot}${path.sep}`)) return null;
  return candidate;
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
  const filePath = staticFilePath(url.pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": url.pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function writeWebResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers[key] = value;
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) headers["set-cookie"] = setCookie;
  res.writeHead(response.status, headers);
  return response.arrayBuffer().then((buffer) => res.end(Buffer.from(buffer)));
}

loadEnvFile(path.join(root, ".env.local"));
process.env.PINO_LOCAL_NODE_POSTGRES ||= "1";

const serverEntry = path.join(root, "dist", "server", "index.js");
const serverMtime = fs.statSync(serverEntry).mtimeMs;
const app = (await import(`${pathToFileURL(serverEntry).href}?t=${serverMtime}`)).default;

http
  .createServer(async (req, res) => {
    try {
      if (serveStatic(req, res)) return;
      const requestUrl = `http://${req.headers.host || `${host}:${port}`}${req.url || "/"}`;
      const body = ["GET", "HEAD"].includes(req.method || "GET") ? undefined : await readBody(req);
      const request = new Request(requestUrl, {
        method: req.method,
        headers: req.headers,
        body,
      });
      const response = await app.fetch(request, {}, { waitUntil: () => {} });
      await writeWebResponse(res, response);
    } catch (error) {
      console.error(error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : "Local preview error");
    }
  })
  .listen(port, host, () => {
    console.log(`Local preview running at http://${host}:${port}`);
  });
