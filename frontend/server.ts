import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";

// The public site is plain static HTML. This server only resolves clean URLs
// and forwards contact-form requests to the backend API.
const publicDir = resolve(import.meta.dir, "public");
const themeScript = '(function(){var saved=localStorage.getItem("theme")||"dark";document.documentElement.setAttribute("data-theme",saved);})();';
const themeScriptHash = createHash("sha256").update(themeScript).digest("base64");
const backendUrl = process.env.API_URL ?? "http://localhost:3001";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".xml": "application/xml; charset=utf-8",
};

function contentType(path: string) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "application/octet-stream" : types[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
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

function safeRelative(pathname: string) {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  if (relative.includes("\0") || relative.split(/[\\/]/).some((part) => part.startsWith("."))) return null;
  return relative;
}

// /blog/ -> blog/index.html and /contact -> contact.html keep links tidy
// without needing a route for every page.
async function resolveFile(pathname: string) {
  let relative = safeRelative(pathname);
  if (relative === null) return null;
  if (relative === "" || relative.endsWith("/")) relative += "index.html";

  const candidates = [relative];
  if (!relative.split("/").pop()?.includes(".")) {
    candidates.push(`${relative}.html`, `${relative}/index.html`);
  }

  for (const candidate of candidates) {
    const filePath = resolve(publicDir, candidate);
    if (!filePath.startsWith(`${publicDir}${sep}`)) continue;
    const file = Bun.file(filePath);
    if (await file.exists()) return { file, relative: candidate };
  }
  return null;
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/api/contact" || url.pathname === "/health") {
      const headers = new Headers(req.headers);
      headers.delete("host");
      headers.delete("x-forwarded-for");
      const address = server.requestIP(req)?.address;
      if (address) headers.set("x-forwarded-for", address);
      headers.set("x-forwarded-host", url.host);
      headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
      const init: RequestInit = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD") init.body = req.body;
      try {
        return await fetch(`${backendUrl}${url.pathname}${url.search}`, { ...init, redirect: "manual" });
      } catch (error) {
        console.error("Backend request failed", error);
        return new Response("Service unavailable", { status: 502, headers: securityHeaders() });
      }
    }

    const resolved = await resolveFile(url.pathname);
    if (!resolved) return new Response("Not found", { status: 404, headers: securityHeaders() });

    const longLived = /\.(?:woff2|png|jpe?g|gif|svg|webp)$/i.test(resolved.relative);
    return new Response(resolved.file, {
      headers: {
        ...securityHeaders(),
        "content-type": contentType(resolved.relative),
        "cache-control": longLived ? "public, max-age=86400" : "no-cache",
      },
    });
  },
});
