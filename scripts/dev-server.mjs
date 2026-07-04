import { createReadStream, existsSync, readFileSync, readdirSync, statSync, watch } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const host = process.env.HOST || "127.0.0.1";
const startPort = Number(process.env.PORT || 5175);
const clients = new Set();
let reloadTimer = null;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"]
]);

const liveReloadSnippet = `
<script type="module">
  const source = new EventSource("/__histui_live_reload");
  source.addEventListener("message", (event) => {
    if (event.data === "reload") window.location.reload();
  });
</script>
`;

function isInsideRoot(filePath) {
  return filePath === root || filePath.startsWith(`${root}${sep}`);
}

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, `http://${host}`);

  if (url.pathname === "/") {
    return join(root, "examples", "basic.html");
  }

  const decodedPath = decodeURIComponent(url.pathname);
  let filePath = resolve(root, `.${decodedPath}`);

  if (!isInsideRoot(filePath)) {
    return null;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!extname(filePath)) {
    const indexPath = join(filePath, "index.html");
    if (existsSync(indexPath)) {
      return indexPath;
    }
  }

  return filePath;
}

function sendNotFound(response) {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function sendHtml(filePath, response) {
  const source = readFileSync(filePath, "utf8");
  const html = source.includes("</body>")
    ? source.replace("</body>", `${liveReloadSnippet}</body>`)
    : `${source}${liveReloadSnippet}`;

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": mimeTypes.get(".html")
  });
  response.end(html);
}

function sendFile(filePath, response) {
  const extension = extname(filePath);

  if (extension === ".html") {
    sendHtml(filePath, response);
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": mimeTypes.get(extension) || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

function broadcastReload() {
  if (reloadTimer) {
    clearTimeout(reloadTimer);
  }

  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    for (const client of clients) {
      client.write("data: reload\n\n");
    }
    console.log("Reloaded connected browser tabs.");
  }, 80);
}

function collectDirectories(directory) {
  const directories = [directory];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      directories.push(...collectDirectories(entryPath));
    }
  }

  return directories;
}

function watchTarget(target) {
  if (!existsSync(target)) {
    return;
  }

  const stats = statSync(target);
  const onChange = () => broadcastReload();

  if (!stats.isDirectory()) {
    watch(target, onChange);
    return;
  }

  try {
    watch(target, { recursive: true }, onChange);
  } catch {
    for (const directory of collectDirectories(target)) {
      watch(directory, onChange);
    }
  }
}

function watchForChanges() {
  for (const target of ["src", "examples", "README.md", "PUBLISHING.md", "package.json"]) {
    watchTarget(join(root, target));
  }
}

function createHistuiDevServer() {
  return createServer((request, response) => {
    const url = new URL(request.url || "/", `http://${host}`);

    if (url.pathname === "/__histui_live_reload") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "connection": "keep-alive",
        "content-type": "text/event-stream"
      });
      response.write("\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }

    const filePath = resolveRequestPath(request.url || "/");
    if (!filePath || !isInsideRoot(filePath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      sendNotFound(response);
      return;
    }

    sendFile(filePath, response);
  });
}

function listen(server, port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      listen(server, port + 1);
      return;
    }

    throw error;
  });

  server.listen(port, host, () => {
    watchForChanges();
    console.log(`Histui package dev server running at http://${host}:${port}`);
    console.log("Serving examples/basic.html with live reload.");
  });
}

listen(createHistuiDevServer(), startPort);
