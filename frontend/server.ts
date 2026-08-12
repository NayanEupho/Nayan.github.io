import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";

const publicDir = resolve(import.meta.dir, "public");
const themeScript = '(function(){var saved=localStorage.getItem("theme")||"dark";document.documentElement.setAttribute("data-theme",saved);})();';
const themeScriptHash = createHash("sha256").update(themeScript).digest("base64");

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

const backendUrl = process.env.API_URL ?? "http://localhost:3001";

function contentType(path: string) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "application/octet-stream" : types[path.slice(dot)] ?? "application/octet-stream";
}

function securityHeaders() {
  return {
    "content-security-policy": `default-src 'self'; img-src 'self' https: data:; style-src 'self'; font-src 'self'; script-src 'self' 'sha256-${themeScriptHash}'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function publicFilePath(pathname: string) {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  if (!relative || relative.includes("\0") || relative.split(/[\\/]/).some((part) => part.startsWith("."))) return null;
  const candidate = resolve(publicDir, relative);
  return candidate.startsWith(`${publicDir}${sep}`) ? { candidate, relative } : null;
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      return new Response(null, { status: 302, headers: { location: "/admin/home" } });
    }

    if (url.pathname === "/admin/posts") {
      return new Response(null, { status: 302, headers: { location: "/admin/post" } });
    }

    const oldBlogPost = url.pathname.match(/^\/blog\/posts\/([^/]+)(\/.*)?$/);
    if (oldBlogPost) {
      return new Response(null, { status: 302, headers: { location: `/blog/post/${oldBlogPost[1]}${oldBlogPost[2] ?? "/"}` } });
    }

    if (
      url.pathname === "/" ||
      url.pathname === "/health" ||
      url.pathname.startsWith("/admin/") ||
      url.pathname === "/blog/" ||
      url.pathname.startsWith("/blog/post/") ||
      url.pathname === "/projects/" ||
      url.pathname.startsWith("/projects/post/") ||
      url.pathname.startsWith("/api/admin/")
    ) {
      const headers = new Headers(req.headers);
      headers.delete("host");
      headers.delete("x-forwarded-for");
      const address = server.requestIP(req)?.address;
      if (address) headers.set("x-forwarded-for", address);
      headers.set("x-forwarded-host", url.host);
      headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
      const init: RequestInit = {
        method: req.method,
        headers,
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = req.body;
      }
      try {
        return await fetch(`${backendUrl}${url.pathname}${url.search}`, {
          ...init,
          redirect: "manual",
        });
      } catch (error) {
        console.error("Backend request failed", error);
        return new Response("Service unavailable", { status: 502, headers: securityHeaders() });
      }
    }

    const resolved = publicFilePath(url.pathname);
    if (!resolved) return new Response("Not found", { status: 404, headers: securityHeaders() });
    const file = Bun.file(resolved.candidate);

    if (await file.exists()) {
      const longLived = /\.(?:woff2|png|jpe?g|gif|svg)$/i.test(resolved.relative);
      return new Response(file, { headers: { ...securityHeaders(), "content-type": contentType(resolved.relative), "cache-control": longLived ? "public, max-age=86400" : "no-cache" } });
    }

    return new Response("Not found", { status: 404, headers: securityHeaders() });
  },
});
