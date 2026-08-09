const publicDir = `${import.meta.dir}/public`;

const routes: Record<string, string> = {
  "/": "index.html",
  "/blog/": "blog/index.html",
  "/blog/posts/hacking-ccd/": "blog/posts/hacking-ccd/index.html",
  "/blog/posts/so-you-want-to-be-a-hacker/": "blog/posts/generic.html",
  "/blog/posts/hacking-cbse/": "blog/posts/generic.html",
  "/blog/posts/finding-vulnerabilities-in-fossunited/": "blog/posts/generic.html",
  "/blog/posts/browser-fingerprinting/": "blog/posts/generic.html",
  "/blog/posts/employment/": "blog/posts/generic.html",
  "/blog/posts/OhSINT/": "blog/posts/generic.html",
  "/blog/posts/how-i-hacked-an-arg-site/": "blog/posts/generic.html",
};

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

function contentType(path: string) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "application/octet-stream" : types[path.slice(dot)] ?? "application/octet-stream";
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/visits") {
      return fetch(`${process.env.API_URL ?? "http://localhost:3001"}/api/visits`, {
        method: req.method,
      });
    }

    const routeFile = routes[url.pathname];
    const relative = routeFile ?? decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const file = Bun.file(`${publicDir}/${relative}`);

    if (await file.exists()) {
      return new Response(file, { headers: { "content-type": contentType(relative) } });
    }

    return new Response("Not found", { status: 404 });
  },
});
