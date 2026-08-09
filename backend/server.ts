import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, normalize } from "node:path";
import { escapeHtml, markdownToHtml } from "./lib/markdown";

type SiteContent = {
  name: string;
  subtitle: string;
  avatar: string;
  location: string;
  timezone: string;
  bio: string[];
  links: {
    blog: string;
    press: string;
    github: string;
    twitter: string;
    email: string;
    resume: string;
  };
};

type PostMeta = {
  title: string;
  date: string;
  slug: string;
  description: string;
  published: boolean;
};

type Post = PostMeta & {
  markdown: string;
  html: string;
};

type PostFilter = "all" | "published" | "draft";

const rootDir = normalize(join(import.meta.dir, ".."));
const contentDir = normalize(process.env.CONTENT_DIR ?? join(rootDir, "content"));
const publicDir = normalize(process.env.PUBLIC_DIR ?? join(rootDir, "frontend", "public"));
const siteFile = join(contentDir, "site.json");
const blogDir = join(contentDir, "blog");
const sessionCookie = "admin_session";
const adminSecret = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;

if (!adminSecret && process.env.NODE_ENV === "production") {
  throw new Error("ADMIN_SECRET or ADMIN_PASSWORD must be set in production");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function safeSlug(value: string) {
  const slug = slugify(value);
  if (!slug) throw new Error("Invalid slug");
  return slug;
}

function safeAssetName(value: string) {
  const name = basename(value).replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!name || name === "." || name === "..") throw new Error("Invalid filename");
  return name;
}

function hmac(value: string) {
  return createHmac("sha256", adminSecret || "dev-admin-secret").update(value).digest("hex");
}

function signSession() {
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 7;
  const payload = String(expires);
  return `${payload}.${hmac(payload)}`;
}

function validSession(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`${sessionCookie}=([^;]+)`));
  if (!match) return false;

  const [expires, sig] = decodeURIComponent(match[1]).split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;

  const expected = hmac(expires);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...(init.headers ?? {}) },
  });
}

function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

async function ensureDirs() {
  await mkdir(blogDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });
}

async function readSite(): Promise<SiteContent> {
  return JSON.parse(await readFile(siteFile, "utf8"));
}

async function writeSite(site: SiteContent) {
  await mkdir(publicDir, { recursive: true });
  await writeFile(siteFile, `${JSON.stringify(site, null, 2)}\n`, "utf8");
  await writeFile(join(publicDir, "index.html"), renderHome(site), "utf8");
}

function parseFrontmatter(raw: string): { meta: PostMeta; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Missing frontmatter");

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const split = line.indexOf(":");
    if (split === -1) continue;
    fields[line.slice(0, split).trim()] = line.slice(split + 1).trim().replace(/^["']|["']$/g, "");
  }

  const title = fields.title || "Untitled";
  const slug = safeSlug(fields.slug || title);
  return {
    meta: {
      title,
      slug,
      date: fields.date || new Date().toISOString().slice(0, 10),
      description: fields.description || "thoughts about programming, security & life",
      published: fields.published !== "false",
    },
    body: match[2].trim(),
  };
}

function frontmatter(meta: PostMeta, body: string) {
  return `---\ntitle: "${meta.title}"\ndate: ${meta.date}\nslug: ${meta.slug}\ndescription: "${meta.description}"\npublished: ${meta.published}\n---\n\n${body.trim()}\n`;
}

function markdownFile(post: PostMeta & { markdown: string }) {
  return frontmatter(post, post.markdown);
}

function imagePlaceholderSrc(src: string, slug: string) {
  const cleanSrc = src.trim();
  if (cleanSrc.startsWith("http://") || cleanSrc.startsWith("https://") || cleanSrc.startsWith("/")) {
    return cleanSrc;
  }
  if (cleanSrc.includes(":")) return cleanSrc;
  return `/blog/post/${slug}/assets/${cleanSrc.replace(/^\.?\/?assets\//, "")}`;
}

function downloadableMarkdownFile(post: PostMeta & { markdown: string }) {
  const body = post.markdown.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_match, src) => {
    return `<image: ${imagePlaceholderSrc(src, post.slug)}>`;
  });
  return frontmatter(post, body);
}

async function readPost(slug: string): Promise<Post> {
  const safe = safeSlug(slug);
  const raw = await readFile(join(blogDir, safe, "index.md"), "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return { ...meta, markdown: body, html: markdownToHtml(body, meta.slug) };
}

async function listPosts(includeDrafts = false) {
  await ensureDirs();
  const entries = await readdir(blogDir, { withFileTypes: true });
  const posts: Post[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const post = await readPost(entry.name);
      if (includeDrafts || post.published) posts.push(post);
    } catch {
      // Skip malformed drafts so one bad file does not take down the blog.
    }
  }

  return posts.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

async function searchPosts(filter: PostFilter, q = "") {
  const posts = await listPosts(true);
  const term = q.trim().toLowerCase();
  return posts.filter((post) => {
    if (filter === "published" && !post.published) return false;
    if (filter === "draft" && post.published) return false;
    if (!term) return true;
    return post.title.toLowerCase().includes(term);
  });
}

async function writePost(input: PostMeta & { markdown: string }) {
  const slug = safeSlug(input.slug || input.title);
  const meta = { ...input, slug, published: Boolean(input.published) };
  const dir = join(blogDir, slug);
  const publicPostDir = join(publicDir, "blog", "post", slug);
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "index.md"), markdownFile({ ...meta, markdown: input.markdown }), "utf8");
  const rendered = renderPost({ ...meta, markdown: input.markdown, html: markdownToHtml(input.markdown, slug) });
  await writeFile(join(dir, "index.html"), rendered, "utf8");
  if (meta.published) {
    await mkdir(publicPostDir, { recursive: true });
    await writeFile(join(publicPostDir, "index.html"), rendered, "utf8");
  } else {
    await rm(publicPostDir, { recursive: true, force: true });
  }
  await mkdir(join(publicDir, "blog"), { recursive: true });
  await writeFile(join(publicDir, "blog", "index.html"), renderBlog(await listPosts(false)), "utf8");
  return readPost(slug);
}

async function updatePost(oldSlug: string, input: PostMeta & { markdown: string }) {
  const previous = safeSlug(oldSlug);
  const next = safeSlug(input.slug || input.title);
  if (previous !== next) {
    await rm(join(blogDir, previous), { recursive: true, force: true });
    await rm(join(publicDir, "blog", "post", previous), { recursive: true, force: true });
    await rm(join(publicDir, "blog", "posts", previous), { recursive: true, force: true });
  }
  return writePost({ ...input, slug: next });
}

async function deletePost(slug: string) {
  const safe = safeSlug(slug);
  await rm(join(blogDir, safe), { recursive: true, force: true });
  await rm(join(publicDir, "blog", "post", safe), { recursive: true, force: true });
  await rm(join(publicDir, "blog", "posts", safe), { recursive: true, force: true });
  await mkdir(join(publicDir, "blog"), { recursive: true });
  await writeFile(join(publicDir, "blog", "index.html"), renderBlog(await listPosts(false)), "utf8");
}

async function publishPost(slug: string) {
  const post = await readPost(slug);
  return writePost({ ...post, published: true });
}

function themeInit() {
  return `<script>(function(){var saved=localStorage.getItem("theme")||"dark";document.documentElement.setAttribute("data-theme",saved);})();</script>`;
}

function bg() {
  return `<div class="bg-canvas"><div class="bg-blob bg-blob-1"></div><div class="bg-blob bg-blob-2"></div><div class="bg-grain"></div></div>`;
}

function themeButton() {
  return `<button class="theme-toggle" aria-label="Toggle theme"><svg class="sun-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg><svg class="moon-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></button>`;
}

function header() {
  return `<header class="site-header"><a href="/" class="header-logo">ni5arga</a><div class="header-actions">${themeButton()}</div></header>`;
}

function footer() {
  return `<footer><div class="footer-inner"><span class="footer-credit"><a href="/">ni5arga</a></span><div class="footer-links"><a href="https://github.com/ni5arga" target="_blank" rel="noopener noreferrer" aria-label="GitHub">GitHub</a><a href="https://x.com/ni5arga" target="_blank" rel="noopener noreferrer" aria-label="X/Twitter">X</a></div></div></footer>`;
}

function shell(title: string, body: string, bodyClass = "") {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="stylesheet" href="/styles.css">
    ${themeInit()}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
${body}
<script src="/site.js"></script>
</body>
</html>`;
}

function renderHome(site: SiteContent) {
  const bio = site.bio.map((p) => `<p class="hero-bio">${p}</p>`).join("\n");
  return shell(`${site.name} - Nisarga Adhikary`, `${bg()}
${themeButton()}
<main class="hero"><div class="hero-content">
<img src="${escapeHtml(site.avatar)}" alt="${escapeHtml(site.name)}" class="avatar">
<h1 class="hero-name">${escapeHtml(site.name)}</h1>
<p class="hero-aka"> ${escapeHtml(site.subtitle)}</p>
${bio}
<div class="hero-links"><a href="${site.links.blog}">blog</a><a href="${site.links.press}">press</a><a href="${site.links.github}" target="_blank">github</a><a href="${site.links.twitter}" target="_blank">twitter</a><a href="mailto:${site.links.email}">email</a></div>
</div></main>
<footer class="home-footer"><span class="footer-location">📍 ${escapeHtml(site.location)}</span><span class="footer-dot"></span><span class="footer-time" id="localTime"></span></footer>`, "home-page");
}

function renderBlog(posts: Post[]) {
  const rows = posts.map((post) => `<article class="blog-post"><p class="blog-date">${formatDate(post.date)}</p><h2><a href="/blog/post/${post.slug}/" class="blog-post-title">${escapeHtml(post.title)}</a></h2></article>`).join("\n");
  return shell("Blog - ni5arga", `${bg()}${header()}<main><div class="blog-container"><a href="/" class="back">← back home</a><div class="blog-header"><h1 class="blog-title">Blog</h1><p class="blog-subtitle">Thoughts on programming, security, and whatever else is on my mind.</p></div><div class="blog-list">${rows}</div></div></main>${footer()}`);
}

function renderPost(post: Post) {
  return shell(`${post.title} - ni5arga`, `${bg()}${header()}<main><article><a href="/blog/" class="back">← back to blog</a><h1>${escapeHtml(post.title)}</h1><p class="post-meta">${formatDate(post.date)}</p><div class="post-content">${post.html}</div></article></main>${footer()}`);
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

type AdminPage = "home" | "posts" | "new-post" | "post";

function adminNav(active: AdminPage) {
  const item = (href: string, key: AdminPage, label: string) => `<a href="${href}" class="${active === key || (active === "post" && key === "posts") ? "active" : ""}">${label}</a>`;
  return `<nav class="admin-tabs">${item("/admin/home", "home", "Home")}${item("/admin/post", "posts", "Posts")}${item("/admin/new-post", "new-post", "New Post")}</nav>`;
}

function icon(name: "filter" | "search" | "preview" | "edit" | "download" | "trash") {
  const paths = {
    filter: '<path d="M3 5h18l-7 8v5l-4 2v-7Z"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    preview: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path>',
  };
  return `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function postBadge(post: PostMeta) {
  return `<span class="post-badge ${post.published ? "published" : "draft"}">${post.published ? "Blog" : "Saved Draft"}</span>`;
}

function adminPostContent(post: Post) {
  const deleteButton = post.published ? `<button type="button" class="icon-button danger" data-detail-delete="${post.slug}" aria-label="Delete post" title="Delete">${icon("trash")}<span class="sr-only">Delete</span></button>` : "";
  return `<section class="admin-section posts-section">
    <article class="admin-post-view">
      <article>
        <a href="/admin/post" class="back">← Back to admin post library</a>
        <div class="admin-post-title-row"><h1 class="admin-post-title">${escapeHtml(post.title)}</h1><div class="admin-title-tools">${postBadge(post)}<div class="admin-action-buttons"><button type="button" class="icon-button" data-detail-preview="${post.slug}" aria-label="Preview post" title="Preview">${icon("preview")}<span class="sr-only">Preview</span></button><button type="button" class="icon-button" data-detail-edit="${post.slug}" aria-label="Edit post" title="Edit">${icon("edit")}<span class="sr-only">Edit</span></button><button type="button" class="icon-button" data-detail-download="${post.slug}" aria-label="Download Markdown" title="Download .md">${icon("download")}<span class="sr-only">Download .md</span></button>${deleteButton}</div></div></div>
        <p class="post-meta">${formatDate(post.date)}</p>
        <div class="post-content">${post.html}</div>
      </article>
    </article>
  </section>`;
}

function adminPage(page: AdminPage, contentOverride = "") {
  const content = page === "home"
    ? `<section class="admin-section"><form class="site-editor" data-site-form><label>Name<input name="name"></label><label>Subtitle<input name="subtitle"></label><label>Location<input name="location"></label><label>Timezone<input name="timezone"></label><label>GitHub<input name="github"></label><label>Twitter/X<input name="twitter"></label><label>Email<input name="email"></label><label>Resume<input name="resume"></label><label class="wide">Bio paragraphs<textarea name="bio" rows="10"></textarea></label><button type="submit">Save homepage</button></form></section>`
    : page === "posts"
      ? `<section class="admin-section posts-section">
    <div class="posts-admin">
      <div class="posts-toolbar">
        <div class="post-search"><span class="search-icon">${icon("search")}</span><input type="search" data-post-search placeholder="Search"><div class="post-search-menu" data-post-search-menu hidden></div></div>
        <div class="filter-wrap"><button type="button" class="icon-button filter-toggle" data-filter-toggle aria-label="Filter search results" title="Filter search results">${icon("filter")}<span class="filter-count" data-filter-count hidden>0</span></button><div class="filter-menu" data-filter-menu hidden><div class="filter-menu-head"><span>Filters</span><button type="button" class="clear-filter" data-clear-filters aria-label="Clear all filters" title="Clear all filters">×</button></div><button type="button" data-filter="published"><span>Blogs</span><span class="filter-check">✓</span></button><button type="button" data-filter="draft"><span>Saved Drafts</span><span class="filter-check">✓</span></button></div></div>
      </div>
      <p class="admin-status" data-post-status></p>
      <div class="post-library" data-post-library></div>
    </div>
  </section>`
      : page === "new-post"
        ? `<section class="admin-section"><div class="posts-admin"><p class="admin-muted">New post editor will live here next.</p></div></section>`
        : contentOverride;

  return shell("Admin - ni5arga", `${bg()}${themeButton()}<main class="admin-shell">
<section class="admin-login" data-login data-admin-page="${page}">
  <h1 class="blog-title">Admin</h1>
  <form class="admin-login-form" data-login-form><input type="password" name="password" placeholder="Password" autocomplete="current-password"><button type="submit">Sign in</button></form>
  <p data-login-error></p>
</section>
<section class="admin-panel" data-panel data-admin-page="${page}" hidden>
  <div class="admin-top"><div><h1 class="blog-title">Admin</h1><p class="admin-muted">Write, publish, and maintain the site.</p></div><button data-logout>Logout</button></div>
  ${adminNav(page)}
  ${content}
</section>
</main><script src="/admin.js"></script>`);
}

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { ...init, headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) } });
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

function notFoundPage() {
  return shell("Not found - ni5arga", `${bg()}${header()}<main><article><a href="/admin/post" class="back">â† Back to admin post library</a><h1>Not found</h1><p class="post-meta">That post does not exist.</p></article></main>${footer()}`);
}

async function handleAdminApi(req: Request, url: URL) {
  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    const { password } = await req.json();
    if (password !== (process.env.ADMIN_PASSWORD || "admin")) return unauthorized();
    return json({ ok: true }, { headers: { "set-cookie": `${sessionCookie}=${encodeURIComponent(signSession())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` } });
  }
  if (!validSession(req)) return unauthorized();
  if (url.pathname === "/api/admin/logout") return json({ ok: true }, { headers: { "set-cookie": `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } });
  if (url.pathname === "/api/admin/session") return json({ ok: true });
  if (url.pathname === "/api/admin/site") {
    if (req.method === "GET") return json(await readSite());
    if (req.method === "PUT") {
      await writeSite(await req.json());
      return json({ ok: true });
    }
  }
  if (url.pathname === "/api/admin/preview" && req.method === "POST") {
    const { markdown, slug } = await req.json();
    return json({ html: markdownToHtml(markdown ?? "", safeSlug(slug || "preview")) });
  }
  if (url.pathname === "/api/admin/posts") {
    if (req.method === "GET") {
      const filterParam = url.searchParams.get("filter");
      const filter: PostFilter = filterParam === "published" || filterParam === "draft" ? filterParam : "all";
      return json(await searchPosts(filter, url.searchParams.get("q") ?? ""));
    }
    if (req.method === "POST") return json(await writePost(await req.json()));
  }
  const downloadMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)\/download$/);
  if (downloadMatch && req.method === "GET") {
    let post: Post;
    try {
      post = await readPost(downloadMatch[1]);
    } catch {
      return json({ error: "Not found" }, { status: 404 });
    }
    return new Response(downloadableMarkdownFile(post), {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${post.slug}.md"`,
      },
    });
  }
  const publishMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)\/publish$/);
  if (publishMatch && req.method === "POST") return json(await publishPost(publishMatch[1]));
  const postMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)$/);
  if (postMatch) {
    const slug = safeSlug(postMatch[1]);
    if (req.method === "GET") {
      try {
        return json({ ...(await readPost(slug)), assets: await listAssets(slug) });
      } catch {
        return json({ error: "Not found" }, { status: 404 });
      }
    }
    if (req.method === "PUT") return json(await updatePost(slug, await req.json()));
    if (req.method === "DELETE") {
      await deletePost(slug);
      return json({ ok: true });
    }
  }
  const assetsMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)\/assets$/);
  if (assetsMatch && req.method === "POST") {
    const slug = safeSlug(assetsMatch[1]);
    const form = await req.formData();
    const files = form.getAll("asset").filter((file): file is File => file instanceof File);
    const assetDir = join(blogDir, slug, "assets");
    await mkdir(assetDir, { recursive: true });
    for (const file of files) {
      await writeFile(join(assetDir, safeAssetName(file.name)), Buffer.from(await file.arrayBuffer()));
    }
    return json({ ok: true, assets: await listAssets(slug) });
  }
  const deleteAssetMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)\/assets\/(.+)$/);
  if (deleteAssetMatch && req.method === "DELETE") {
    await rm(join(blogDir, safeSlug(deleteAssetMatch[1]), "assets", safeAssetName(deleteAssetMatch[2])), { force: true });
    return json({ ok: true });
  }
  return json({ error: "Not found" }, { status: 404 });
}

async function listAssets(slug: string) {
  const assetDir = join(blogDir, safeSlug(slug), "assets");
  if (!existsSync(assetDir)) return [];
  return (await readdir(assetDir)).map((name) => ({ name, url: `/blog/post/${slug}/assets/${name}` }));
}

async function serveAsset(req: Request, pathname: string) {
  const match = pathname.match(/^\/blog\/post\/([^/]+)\/assets\/(.+)$/);
  if (!match) return null;
  let post: Post;
  try {
    post = await readPost(match[1]);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!post.published && !validSession(req)) return new Response("Not found", { status: 404 });
  const file = Bun.file(join(blogDir, post.slug, "assets", safeAssetName(match[2])));
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file);
}

await ensureDirs();

Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  async fetch(req) {
    try {
      const url = new URL(req.url);
      const asset = await serveAsset(req, url.pathname);
      if (asset) return asset;
      if (url.pathname === "/health") return json({ ok: true });
      if (url.pathname.startsWith("/api/admin/")) return handleAdminApi(req, url);
      if (url.pathname === "/admin" || url.pathname === "/admin/") return redirect("/admin/home");
      if (url.pathname === "/admin/home") return htmlResponse(adminPage("home"));
      if (url.pathname === "/admin/posts") return redirect("/admin/post");
      if (url.pathname === "/admin/post") return htmlResponse(adminPage("posts"));
      if (url.pathname === "/admin/new-post") return htmlResponse(adminPage("new-post"));
      const adminPostRoute = url.pathname.match(/^\/admin\/post\/([^/]+)\/?$/);
      if (adminPostRoute) {
        if (!validSession(req)) return redirect("/admin/home");
        try {
          const post = await readPost(adminPostRoute[1]);
          return htmlResponse(adminPage("post", adminPostContent(post)));
        } catch {
          return htmlResponse(notFoundPage(), { status: 404 });
        }
      }
      const adminPreviewRoute = url.pathname.match(/^\/admin\/preview\/([^/]+)\/$/);
      if (adminPreviewRoute) {
        if (!validSession(req)) return new Response("Not found", { status: 404 });
        try {
          const post = await readPost(adminPreviewRoute[1]);
          return htmlResponse(renderPost(post));
        } catch {
          return htmlResponse(notFoundPage(), { status: 404 });
        }
      }
      if (url.pathname === "/" || url.pathname === "/index.html") return htmlResponse(renderHome(await readSite()));
      if (url.pathname === "/blog/") return htmlResponse(renderBlog(await listPosts(false)));
      const oldPostRoute = url.pathname.match(/^\/blog\/posts\/([^/]+)\/$/);
      if (oldPostRoute) return redirect(`/blog/post/${safeSlug(oldPostRoute[1])}/`);
      const postRoute = url.pathname.match(/^\/blog\/post\/([^/]+)\/$/);
      if (postRoute) {
        if (!existsSync(join(blogDir, safeSlug(postRoute[1]), "index.md"))) {
          return new Response("Not found", { status: 404 });
        }
        const post = await readPost(postRoute[1]);
        if (!post.published && !validSession(req)) return new Response("Not found", { status: 404 });
        return htmlResponse(renderPost(post));
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
    }
  },
});
