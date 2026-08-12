import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, normalize } from "node:path";
import { escapeHtml, markdownToHtml, safeHref, type ContentType } from "./lib/markdown";

type SiteContent = {
  name: string;
  subtitle: string;
  avatar: string;
  location: string;
  timezone: string;
  bio: string[];
  links: {
    blog: string;
    projects: string;
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
  type: ContentType;
};

type Post = PostMeta & {
  markdown: string;
  html: string;
};

type PostFilter = "all" | "blog" | "project" | "published" | "draft";

const rootDir = normalize(join(import.meta.dir, ".."));
const contentDir = normalize(process.env.CONTENT_DIR ?? join(rootDir, "content"));
const publicDir = normalize(process.env.PUBLIC_DIR ?? join(rootDir, "frontend", "public"));
const siteFile = join(contentDir, "site.json");
const blogDir = join(contentDir, "blog");
const sessionCookie = "admin_session";
const adminPassword = process.env.ADMIN_PASSWORD ?? "";
const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const adminSecret = process.env.ADMIN_SESSION_SECRET || createHmac("sha256", adminPassword).update("admin-session").digest("hex");
const adminPreviews = new Map<string, { post: Post; expiresAt: number }>();
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();
const allowedImageTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);
const maxImageBytes = 12 * 1024 * 1024;
const themeScript = '(function(){var saved=localStorage.getItem("theme")||"dark";document.documentElement.setAttribute("data-theme",saved);})();';
const themeScriptHash = createHash("sha256").update(themeScript).digest("base64");
let mutationQueue = Promise.resolve();

if (adminPassword.length < 8) {
  throw new Error("ADMIN_PASSWORD must be set to at least 8 characters");
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

function mutate<T>(operation: () => Promise<T>) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
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
  const name = basename(value).replace(/[^a-zA-Z0-9.@_-]/g, "-");
  if (!name || name === "." || name === "..") throw new Error("Invalid filename");
  if (!allowedImageTypes.has(extname(name).toLowerCase())) throw new Error("Unsupported image type");
  return name;
}

function sanitizeBioHtml(value: string) {
  const anchors: string[] = [];
  const tokenized = value.replace(/<a\s+href=(['"])(.*?)\1(?:\s+target=(['"])_blank\3)?\s*>(.*?)<\/a>/gi, (_match, _hrefQuote, href, targetQuote, label) => {
    const token = `BIOANCHOR${anchors.length}TOKEN`;
    const target = targetQuote ? ' target="_blank" rel="noopener noreferrer"' : "";
    anchors.push(`<a href="${safeHref(href)}"${target}>${escapeHtml(label)}</a>`);
    return token;
  });
  let sanitized = escapeHtml(tokenized);
  anchors.forEach((anchor, index) => {
    sanitized = sanitized.replace(`BIOANCHOR${index}TOKEN`, anchor);
  });
  return sanitized;
}

function requestIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "direct";
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(hmac(left), "hex");
  const b = Buffer.from(hmac(right), "hex");
  return timingSafeEqual(a, b);
}

function validRequestOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") return false;
  const origin = req.headers.get("origin");
  return !origin || origin === appOrigin;
}

function textField(value: unknown, label: string, maxLength: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maxLength) throw new Error(`${label} is too long`);
  return text;
}

function contentType(value: unknown): ContentType {
  if (value === undefined || value === null || value === "") return "blog";
  if (value === "blog" || value === "project") return value;
  throw new Error("Type must be blog or project");
}

function publicSection(type: ContentType) {
  return type === "project" ? "projects" : "blog";
}

function publicPostPath(type: ContentType, slug: string) {
  return `/${publicSection(type)}/post/${slug}/`;
}

function normalizePostInput(value: unknown): PostMeta & { markdown: string } {
  if (!value || typeof value !== "object") throw new Error("Invalid post data");
  const input = value as Record<string, unknown>;
  const title = textField(input.title, "Title", 180);
  const slug = safeSlug(String(input.slug || title));
  const date = String(input.date ?? "");
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error("Invalid date");
  const markdown = String(input.markdown ?? "");
  if (!markdown.trim()) throw new Error("Markdown is required");
  if (Buffer.byteLength(markdown, "utf8") > 2 * 1024 * 1024) throw new Error("Markdown must be smaller than 2 MB");
  return {
    title,
    slug,
    date,
    description: textField(input.description, "Description", 500),
    published: input.published === true,
    type: contentType(input.type),
    markdown,
  };
}

function normalizeSiteInput(value: unknown): SiteContent {
  if (!value || typeof value !== "object") throw new Error("Invalid site data");
  const input = value as Record<string, unknown>;
  const links = input.links as Record<string, unknown> | undefined;
  if (!links || typeof links !== "object") throw new Error("Site links are required");
  const bio = Array.isArray(input.bio) ? input.bio.map((line) => textField(line, "Bio paragraph", 2000)) : [];
  if (!bio.length || bio.length > 20) throw new Error("Add between 1 and 20 bio paragraphs");
  const timezone = textField(input.timezone, "Timezone", 80);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error("Invalid timezone");
  }
  return {
    name: textField(input.name, "Name", 100),
    subtitle: textField(input.subtitle, "Subtitle", 160),
    avatar: textField(input.avatar, "Avatar", 500),
    location: textField(input.location, "Location", 120),
    timezone,
    bio,
    links: {
      blog: textField(links.blog, "Blog link", 500),
      projects: textField(links.projects || "/projects/", "Projects link", 500),
      press: textField(links.press, "Press link", 500),
      github: textField(links.github, "GitHub link", 500),
      twitter: textField(links.twitter, "Twitter link", 500),
      email: textField(links.email, "Email", 320),
      resume: textField(links.resume, "Resume link", 500),
    },
  };
}

function validImageSignature(bytes: Uint8Array, extension: string) {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (extension === ".png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (extension === ".jpg" || extension === ".jpeg") return starts(0xff, 0xd8, 0xff);
  if (extension === ".gif") return starts(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
  if (extension === ".webp") return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return false;
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
    headers: { "cache-control": "no-store", ...securityHeaders(), ...(init.headers ?? {}) },
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
  const site = JSON.parse(await readFile(siteFile, "utf8")) as SiteContent;
  site.links.projects ||= "/projects/";
  return site;
}

async function writeSite(site: SiteContent) {
  await mkdir(publicDir, { recursive: true });
  await atomicWrite(siteFile, `${JSON.stringify(site, null, 2)}\n`);
  await atomicWrite(join(publicDir, "index.html"), renderHome(site));
}

async function atomicWrite(path: string, content: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function parseFrontmatter(raw: string): { meta: PostMeta; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Missing frontmatter");

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const split = line.indexOf(":");
    if (split === -1) continue;
    const rawValue = line.slice(split + 1).trim();
    try {
      fields[line.slice(0, split).trim()] = rawValue.startsWith('"') ? JSON.parse(rawValue) : rawValue.replace(/^'|'$/g, "");
    } catch {
      throw new Error("Invalid frontmatter value");
    }
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
      type: contentType(fields.type),
    },
    body: match[2].trim(),
  };
}

function frontmatter(meta: PostMeta, body: string) {
  return `---\ntitle: ${JSON.stringify(meta.title)}\ndate: ${meta.date}\nslug: ${meta.slug}\ndescription: ${JSON.stringify(meta.description)}\ntype: ${meta.type}\npublished: ${meta.published}\n---\n\n${body.trim()}\n`;
}

function markdownFile(post: PostMeta & { markdown: string }) {
  return frontmatter(post, post.markdown);
}

function imagePlaceholderSrc(src: string, slug: string, type: ContentType) {
  const cleanSrc = src.trim();
  if (cleanSrc.startsWith("http://") || cleanSrc.startsWith("https://") || cleanSrc.startsWith("/")) {
    return cleanSrc;
  }
  if (cleanSrc.includes(":")) return cleanSrc;
  return `${publicPostPath(type, slug)}assets/${cleanSrc.replace(/^\.?\/?assets\//, "")}`;
}

function downloadableMarkdownFile(post: PostMeta & { markdown: string }) {
  const body = post.markdown.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_match, src) => {
    return `<image: ${imagePlaceholderSrc(src, post.slug, post.type)}>`;
  });
  return frontmatter(post, body);
}

async function readPost(slug: string): Promise<Post> {
  const safe = safeSlug(slug);
  const raw = await readFile(join(blogDir, safe, "index.md"), "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return { ...meta, markdown: body, html: markdownToHtml(body, meta.slug, meta.type) };
}

async function readPostMeta(slug: string): Promise<PostMeta> {
  const safe = safeSlug(slug);
  const raw = await readFile(join(blogDir, safe, "index.md"), "utf8");
  return parseFrontmatter(raw).meta;
}

async function listPosts(includeDrafts = false, type?: ContentType) {
  await ensureDirs();
  const entries = await readdir(blogDir, { withFileTypes: true });
  const posts: PostMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const post = await readPostMeta(entry.name);
      if ((includeDrafts || post.published) && (!type || post.type === type)) posts.push(post);
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
    if (filter === "blog" && post.type !== "blog") return false;
    if (filter === "project" && post.type !== "project") return false;
    if (!term) return true;
    return post.title.toLowerCase().includes(term);
  });
}

async function regenerateIndexes() {
  await Promise.all([
    atomicWrite(join(publicDir, "blog", "index.html"), renderListing(await listPosts(false, "blog"), "blog")),
    atomicWrite(join(publicDir, "projects", "index.html"), renderListing(await listPosts(false, "project"), "project")),
  ]);
}

async function removePublicPost(slug: string) {
  await Promise.all([
    rm(join(publicDir, "blog", "post", slug), { recursive: true, force: true }),
    rm(join(publicDir, "projects", "post", slug), { recursive: true, force: true }),
    rm(join(publicDir, "blog", "posts", slug), { recursive: true, force: true }),
  ]);
}

async function writePost(rawInput: unknown) {
  const input = normalizePostInput(rawInput);
  const slug = safeSlug(input.slug || input.title);
  const meta = { ...input, slug, published: Boolean(input.published) };
  const dir = join(blogDir, slug);
  const publicPostDir = join(publicDir, publicSection(meta.type), "post", slug);
  await mkdir(join(dir, "assets"), { recursive: true });
  await atomicWrite(join(dir, "index.md"), markdownFile({ ...meta, markdown: input.markdown }));
  const rendered = renderPost({ ...meta, markdown: input.markdown, html: markdownToHtml(input.markdown, slug, meta.type) });
  await atomicWrite(join(dir, "index.html"), rendered);
  if (meta.published) {
    await rm(join(publicDir, publicSection(meta.type === "blog" ? "project" : "blog"), "post", slug), { recursive: true, force: true });
    await mkdir(publicPostDir, { recursive: true });
    await atomicWrite(join(publicPostDir, "index.html"), rendered);
  } else {
    await removePublicPost(slug);
  }
  await regenerateIndexes();
  return readPost(slug);
}

async function createPost(rawInput: unknown) {
  const input = normalizePostInput(rawInput);
  const slug = safeSlug(input.slug || input.title);
  const dir = join(blogDir, slug);
  try {
    // Directory creation is atomic, so concurrent requests cannot claim one slug.
    await mkdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A post with this slug already exists");
    throw error;
  }

  try {
    return await writePost({ ...input, slug });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function updatePost(oldSlug: string, rawInput: unknown) {
  const input = normalizePostInput(rawInput);
  const previous = safeSlug(oldSlug);
  const next = safeSlug(input.slug || input.title);
  if (previous !== next) {
    if (existsSync(join(blogDir, next))) throw new Error("A post with this slug already exists");
    await rename(join(blogDir, previous), join(blogDir, next));
    await removePublicPost(previous);
  }
  return writePost({ ...input, slug: next });
}

async function deletePost(slug: string) {
  const safe = safeSlug(slug);
  await rm(join(blogDir, safe), { recursive: true, force: true });
  await removePublicPost(safe);
  await regenerateIndexes();
}

async function publishPost(slug: string) {
  const post = await readPost(slug);
  return writePost({ ...post, published: true });
}

function themeInit() {
  return `<script>${themeScript}</script>`;
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

type StyleSet = "home" | "content" | "admin";

function stylesheetLinks(styleSet: StyleSet) {
  const files = styleSet === "home"
    ? ["shared", "site"]
    : styleSet === "admin"
      ? ["shared", "content", "admin", "editor"]
      : ["shared", "site", "content"];
  return files.map((file) => `<link rel="stylesheet" href="/styles/${file}.css">`).join("\n    ");
}

function shell(title: string, body: string, bodyClass = "", styleSet: StyleSet = "content") {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    ${stylesheetLinks(styleSet)}
    ${themeInit()}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
${body}
<script src="/site.js"></script>
</body>
</html>`;
}

function renderHome(site: SiteContent) {
  const bio = site.bio.map((p) => `<p class="hero-bio">${sanitizeBioHtml(p)}</p>`).join("\n");
  const externalLink = (href: string, label: string) => `<a href="${safeHref(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  return shell(`${site.name} - Nisarga Adhikary`, `${bg()}
${themeButton()}
<main class="hero" data-timezone="${escapeHtml(site.timezone)}"><div class="hero-content">
<img src="${safeHref(site.avatar)}" alt="${escapeHtml(site.name)}" class="avatar">
<h1 class="hero-name">${escapeHtml(site.name)}</h1>
<p class="hero-aka"> ${escapeHtml(site.subtitle)}</p>
${bio}
<div class="hero-links"><a href="${safeHref(site.links.blog)}">blog</a><a href="${safeHref(site.links.projects)}">projects</a>${externalLink(site.links.github, "github")}${externalLink(site.links.twitter, "twitter")}<a href="${safeHref(`mailto:${site.links.email}`)}">email</a></div>
</div></main>
<footer class="home-footer"><span class="footer-location">📍 ${escapeHtml(site.location)}</span><span class="footer-dot"></span><span class="footer-time" id="localTime"></span></footer>`, "home-page", "home");
}

function renderListing(posts: PostMeta[], type: ContentType) {
  const section = publicSection(type);
  const title = type === "project" ? "Projects" : "Blog";
  const subtitle = type === "project" ? "Things I have built, explored, and learned from." : "Thoughts on programming, security, and whatever else is on my mind.";
  const rows = posts.map((post) => `<article class="blog-post"><p class="blog-date">${formatDate(post.date)}</p><h2><a href="/${section}/post/${post.slug}/" class="blog-post-title">${escapeHtml(post.title)}</a></h2></article>`).join("\n");
  const empty = `<p class="blog-empty">No ${type === "project" ? "projects" : "posts"} yet.</p>`;
  return shell(`${title} - ni5arga`, `${bg()}${header()}<main><div class="blog-container"><a href="/" class="back">&larr; back home</a><div class="blog-header"><h1 class="blog-title">${title}</h1><p class="blog-subtitle">${subtitle}</p></div><div class="blog-list">${rows || empty}</div></div></main>${footer()}`);
}

function renderPost(post: Post) {
  const section = publicSection(post.type);
  const label = post.type === "project" ? "projects" : "blog";
  return shell(`${post.title} - ni5arga`, `${bg()}${header()}<main><article><a href="/${section}/" class="back">&larr; back to ${label}</a><h1>${escapeHtml(post.title)}</h1><p class="post-meta">${formatDate(post.date)}</p><div class="post-content">${post.html}</div></article></main>${footer()}`);
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

type AdminPage = "home" | "posts" | "new-post" | "edit-post" | "post";

function adminNav(active: AdminPage) {
  const item = (href: string, key: AdminPage, label: string) => `<a href="${href}" class="${active === key || ((active === "post" || active === "edit-post") && key === "posts") ? "active" : ""}">${label}</a>`;
  return `<nav class="admin-tabs">${item("/admin/home", "home", "Home")}${item("/admin/post", "posts", "Posts")}${item("/admin/new-post", "new-post", "New Post")}</nav>`;
}

function icon(name: "filter" | "search" | "preview" | "edit" | "download" | "trash" | "image" | "link" | "code" | "quote" | "external") {
  const paths = {
    filter: '<path d="M3 5h18l-7 8v5l-4 2v-7Z"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    preview: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"></path>',
    code: '<path d="m8 9-3 3 3 3"></path><path d="m16 9 3 3-3 3"></path><path d="m14 5-4 14"></path>',
    quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h3c0 3-1 5-4 6"></path><path d="M14 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h3c0 3-1 5-4 6"></path>',
    external: '<path d="M15 3h6v6"></path><path d="m10 14 11-11"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
  };
  return `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function postBadge(post: PostMeta) {
  const label = post.published ? (post.type === "project" ? "Project" : "Blog") : "Saved Draft";
  return `<span class="post-badge ${post.published ? `published ${post.type}` : "draft"}" data-post-type="${post.type}">${label}</span>`;
}

function adminPostContent(post: Post) {
  const deleteButton = `<button type="button" class="icon-button danger" data-detail-delete="${post.slug}" data-detail-kind="${post.published ? "post" : "draft"}" aria-label="Delete ${post.published ? "post" : "draft"}" title="Delete">${icon("trash")}<span class="sr-only">Delete</span></button>`;
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

function today() {
  // The site is authored in India while the container itself runs in UTC.
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

function newPostMarkdown() {
  return `Start the post here.

### First section

Write the first idea in plain Markdown.

\`\`\`txt
code blocks work here
\`\`\`

![Image description](assets/example.png)`;
}

function postEditorContent(mode: "new" | "edit", post?: Post) {
  const isEdit = mode === "edit";
  const title = post?.title ?? "New Post Title";
  const slug = post?.slug ?? `new-post-${Date.now().toString(36)}`;
  const description = post?.description ?? "thoughts about programming, security & life";
  const date = post?.date ?? today();
  const markdown = post?.markdown ?? newPostMarkdown();
  const published = post?.published ?? false;
  const type = post?.type ?? "blog";
  const livePath = publicPostPath(type, slug);
  const status = isEdit ? (published ? "Published" : "Saved Draft") : "New";
  const editActions = published
    ? `<button type="button" class="icon-button" data-editor-final-preview>${icon("preview")}<span>Preview changes</span></button><a class="button-link icon-button" href="${escapeHtml(livePath)}" target="_blank" rel="noopener" data-editor-live-link>${icon("external")}<span>View live</span></a><button type="button" class="primary-action" data-edit-update disabled>Update live post</button>`
    : `<button type="button" class="icon-button" data-editor-final-preview>${icon("preview")}<span>Preview changes</span></button><button type="button" data-edit-save disabled>Save changes</button><button type="button" class="primary-action" data-edit-publish>Publish</button>`;
  const newActions = `<button type="button" class="icon-button" data-editor-final-preview>${icon("preview")}<span>Preview</span></button><button type="button" data-editor-save-draft>Save draft</button><button type="button" class="primary-action" data-editor-publish>Publish</button>`;
  const assets = `<div class="asset-strip" data-asset-strip>
      <div class="editor-section-title"><span>Image library</span><span class="admin-muted">Original-quality files for this post. Type <code>assets/@</code> in Markdown to find one.</span></div>
      <label class="asset-picker"><input type="file" name="asset" data-asset-input accept="image/*" multiple><span>${icon("image")} Upload HQ images</span></label>
      <div class="asset-list" data-assets>${isEdit ? "" : '<p class="admin-muted">No images added yet.</p>'}</div>
    </div>`;

  return `<section class="admin-section">
    <form class="post-editor ${isEdit ? "edit-post-editor" : ""}" data-post-editor data-editor-mode="${mode}" data-editor-published="${published}" data-editor-type="${type}" ${isEdit ? `data-editor-slug="${escapeHtml(slug)}"` : ""}>
      <div class="post-editor-head">
        <div>
          <a href="${isEdit ? `/admin/post/${escapeHtml(slug)}` : "/admin/post"}" class="back" data-editor-back>${isEdit ? "← Back to post" : "← Back to admin post library"}</a>
          <h2 data-editor-heading>${isEdit ? "Edit Post" : "New Post"}</h2>
          <p class="admin-muted" data-editor-copy>${isEdit ? (published ? "Review changes before updating the live post." : "Continue this saved draft and publish it when ready.") : "Create a fresh Markdown post. This page is only for new posts."}</p>
        </div>
        <div class="admin-actions">
          ${isEdit ? editActions : newActions}
        </div>
      </div>
      <div class="post-meta-grid">
        <label>Title<input name="title" value="${escapeHtml(title)}" required></label>
        <label>Date<input name="date" type="date" value="${escapeHtml(date)}" required></label>
        <label>Slug<span class="slug-field"><input name="slug" value="${escapeHtml(slug)}" required pattern="[a-z0-9-]+"><small data-slug-status aria-live="polite"></small></span></label>
        <fieldset class="post-type-field"><legend>Type</legend><div class="post-type-control"><label><input type="radio" name="type" value="blog" ${type === "blog" ? "checked" : ""}><span>Blog</span></label><label><input type="radio" name="type" value="project" ${type === "project" ? "checked" : ""}><span>Project</span></label></div></fieldset>
        <div class="status-field"><span>Status</span><span class="editor-status-tag ${status.toLowerCase().replace(" ", "-")}" data-editor-status-tag>${status}</span>${isEdit ? '<small class="editor-save-state" data-editor-save-state>All changes saved</small>' : ""}</div>
        <label class="wide">Description<input name="description" value="${escapeHtml(description)}" required></label>
        <div class="markdown-field editor-workbench" data-editor-workbench>
          <div class="editor-bar">
            <div class="editor-tabs" role="tablist" aria-label="Editor view"><button type="button" class="active" data-editor-tab="write" role="tab" aria-selected="true">Write</button><button type="button" data-editor-tab="preview" role="tab" aria-selected="false">Preview</button></div>
            <div class="markdown-tools" aria-label="Markdown formatting">
              <button type="button" data-markdown-action="bold" title="Bold" aria-label="Bold"><strong>B</strong></button>
              <button type="button" data-markdown-action="italic" title="Italic" aria-label="Italic"><em>I</em></button>
              <button type="button" data-markdown-action="link" title="Link" aria-label="Insert link">${icon("link")}</button>
              <button type="button" data-markdown-action="quote" title="Quote" aria-label="Quote">${icon("quote")}</button>
              <button type="button" data-markdown-action="code" title="Code block" aria-label="Code block">${icon("code")}</button>
              <button type="button" data-pick-image title="Insert image" aria-label="Insert image">${icon("image")}</button>
            </div>
          </div>
          <label class="sr-only" for="post-markdown">Markdown</label>
          <textarea id="post-markdown" name="markdown" rows="22" required data-markdown-input>${escapeHtml(markdown)}</textarea>
          <div class="editor-rendered post-content" data-editor-rendered hidden></div>
          <div class="asset-autocomplete" data-asset-autocomplete hidden></div>
          <p class="editor-drop-hint">Drop images anywhere in the editor</p>
        </div>
        ${assets}
      </div>
      <p class="admin-status" data-editor-status></p>
    </form>
  </section>`;
}

function adminPage(page: AdminPage, contentOverride = "") {
  const content = page === "home"
    ? `<section class="admin-section"><form class="site-editor" data-site-form><label>Name<input name="name"></label><label>Subtitle<input name="subtitle"></label><label>Location<input name="location"></label><label>Timezone<input name="timezone"></label><label>GitHub<input name="github"></label><label>Twitter/X<input name="twitter"></label><label>Email<input name="email"></label><label>Resume<input name="resume"></label><label class="wide">Bio paragraphs<textarea name="bio" rows="10"></textarea></label><button type="submit">Save homepage</button></form></section>`
    : page === "posts"
      ? `<section class="admin-section posts-section">
    <div class="posts-admin">
      <div class="posts-toolbar">
        <div class="post-search"><span class="search-icon">${icon("search")}</span><label class="sr-only" for="admin-post-search">Search post titles</label><input id="admin-post-search" name="post-search" type="search" data-post-search placeholder="Search"><div class="post-search-menu" data-post-search-menu hidden></div></div>
        <div class="filter-wrap"><button type="button" class="icon-button filter-toggle" data-filter-toggle aria-label="Filter search results" title="Filter search results">${icon("filter")}<span class="filter-count" data-filter-count hidden>0</span></button><div class="filter-menu" data-filter-menu hidden><div class="filter-menu-head"><span>Filters</span><button type="button" class="clear-filter" data-clear-filters aria-label="Clear all filters" title="Clear all filters">&times;</button></div><button type="button" data-filter="blog"><span>Blogs</span><span class="filter-check">&#10003;</span></button><button type="button" data-filter="project"><span>Projects</span><span class="filter-check">&#10003;</span></button><button type="button" data-filter="draft"><span>Saved Drafts</span><span class="filter-check">&#10003;</span></button></div></div>
      </div>
      <p class="admin-status" data-post-status></p>
      <div class="post-library" data-post-library></div>
    </div>
  </section>`
      : page === "new-post"
        ? postEditorContent("new")
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
</main><script src="/admin.js"></script>`, "", "admin");
}

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { ...init, headers: { "content-type": "text/html; charset=utf-8", ...securityHeaders(), ...(init.headers ?? {}) } });
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

function notFoundPage() {
  return shell("Not found - ni5arga", `${bg()}${header()}<main><article><a href="/admin/post" class="back">â† Back to admin post library</a><h1>Not found</h1><p class="post-meta">That post does not exist.</p></article></main>${footer()}`);
}

async function handleAdminApi(req: Request, url: URL) {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !validRequestOrigin(req)) {
    return json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    const ip = requestIp(req);
    const now = Date.now();
    for (const [address, entry] of loginAttempts) {
      if (entry.blockedUntil && entry.blockedUntil < now) loginAttempts.delete(address);
    }
    while (loginAttempts.size >= 1000) {
      const oldest = loginAttempts.keys().next().value;
      if (!oldest) break;
      loginAttempts.delete(oldest);
    }
    const attempt = loginAttempts.get(ip);
    if (attempt?.blockedUntil && attempt.blockedUntil > now) {
      return json({ error: "Too many login attempts. Try again later." }, { status: 429, headers: { "retry-after": String(Math.ceil((attempt.blockedUntil - now) / 1000)) } });
    }
    const body = await req.json().catch(() => ({})) as { password?: unknown };
    if (!secureEqual(String(body.password ?? ""), adminPassword)) {
      const failures = (attempt?.failures ?? 0) + 1;
      loginAttempts.set(ip, { failures, blockedUntil: failures >= 5 ? now + 15 * 60 * 1000 : 0 });
      return failures >= 5
        ? json({ error: "Too many login attempts. Try again later." }, { status: 429, headers: { "retry-after": "900" } })
        : json({ error: "You gotta try harder than that." }, { status: 401 });
    }
    loginAttempts.delete(ip);
    const secure = appOrigin.startsWith("https://") ? "; Secure" : "";
    return json({ ok: true }, { headers: { "set-cookie": `${sessionCookie}=${encodeURIComponent(signSession())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}` } });
  }
  if (!validSession(req)) return unauthorized();
  if (url.pathname === "/api/admin/logout" && req.method === "POST") return json({ ok: true }, { headers: { "set-cookie": `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` } });
  if (url.pathname === "/api/admin/session") return json({ ok: true });
  if (url.pathname === "/api/admin/site") {
    if (req.method === "GET") return json(await readSite());
    if (req.method === "PUT") {
      try {
        const site = normalizeSiteInput(await req.json());
        await mutate(() => writeSite(site));
        return json({ ok: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid site data" }, { status: 400 });
      }
    }
  }
  if (url.pathname === "/api/admin/preview" && req.method === "POST") {
    const { markdown, slug, assetSlug, type } = await req.json();
    if (Buffer.byteLength(String(markdown ?? ""), "utf8") > 2 * 1024 * 1024) return json({ error: "Markdown must be smaller than 2 MB" }, { status: 413 });
    return json({ html: markdownToHtml(markdown ?? "", safeSlug(assetSlug || slug || "preview"), contentType(type)) });
  }
  if (url.pathname === "/api/admin/previews" && req.method === "POST") {
    for (const [previewId, preview] of adminPreviews) {
      if (preview.expiresAt < Date.now()) adminPreviews.delete(previewId);
    }
    while (adminPreviews.size >= 50) {
      const oldest = adminPreviews.keys().next().value;
      if (!oldest) break;
      adminPreviews.delete(oldest);
    }
    const rawInput = await req.json() as PostMeta & { markdown: string; assetSlug?: string };
    const input = normalizePostInput(rawInput);
    const slug = safeSlug(input.slug || input.title || "preview");
    const assetSlug = safeSlug(rawInput.assetSlug || slug);
    const post: Post = {
      title: String(input.title || "Untitled post"),
      date: String(input.date || today()),
      slug,
      description: String(input.description || ""),
      published: Boolean(input.published),
      type: input.type,
      markdown: String(input.markdown || ""),
      html: markdownToHtml(String(input.markdown || ""), assetSlug, input.type),
    };
    const id = randomUUID();
    adminPreviews.set(id, { post, expiresAt: Date.now() + 15 * 60 * 1000 });
    return json({ id });
  }
  if (url.pathname === "/api/admin/posts/slug-available" && req.method === "GET") {
    const slug = safeSlug(url.searchParams.get("slug") ?? "");
    const current = url.searchParams.get("current");
    const available = current === slug || !existsSync(join(blogDir, slug));
    return json({ slug, available });
  }
  if (url.pathname === "/api/admin/posts") {
    if (req.method === "GET") {
      const filterParam = url.searchParams.get("filter");
      const filter: PostFilter = filterParam === "published" || filterParam === "draft" || filterParam === "blog" || filterParam === "project" ? filterParam : "all";
      return json(await searchPosts(filter, (url.searchParams.get("q") ?? "").slice(0, 200)));
    }
    if (req.method === "POST") {
      try {
        const input = await req.json();
        return json(await mutate(() => createPost(input)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not create post";
        return json({ error: message }, { status: message.includes("already exists") ? 409 : 400 });
      }
    }
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
  if (publishMatch && req.method === "POST") return json(await mutate(() => publishPost(publishMatch[1])));
  const postMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)$/);
  if (postMatch) {
    const slug = safeSlug(postMatch[1]);
    if (req.method === "GET") {
      try {
        const post = await readPost(slug);
        return json({ ...post, assets: await listAssets(slug, post.type) });
      } catch {
        return json({ error: "Not found" }, { status: 404 });
      }
    }
    if (req.method === "PUT") {
      try {
        const input = await req.json();
        return json(await mutate(() => updatePost(slug, input)));
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Could not update post" }, { status: 400 });
      }
    }
    if (req.method === "DELETE") {
      await mutate(() => deletePost(slug));
      return json({ ok: true });
    }
  }
  const assetsMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)\/assets$/);
  if (assetsMatch && req.method === "POST") {
    const slug = safeSlug(assetsMatch[1]);
    try {
      await readPost(slug);
    } catch {
      return json({ error: "Save the draft before adding images" }, { status: 404 });
    }
    const form = await req.formData();
    const files = form.getAll("asset").filter((file): file is File => file instanceof File);
    if (!files.length) return json({ error: "Choose at least one image" }, { status: 400 });
    if (files.length > 20) return json({ error: "Upload no more than 20 images at once" }, { status: 400 });
    if (files.some((file) => file.size > maxImageBytes)) return json({ error: "Images must be smaller than 12 MB" }, { status: 400 });
    if (files.reduce((total, file) => total + file.size, 0) > 48 * 1024 * 1024) return json({ error: "Upload batches must be smaller than 48 MB" }, { status: 400 });
    const assetDir = join(blogDir, slug, "assets");
    await mkdir(assetDir, { recursive: true });
    const uploads: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const file of files) {
      try {
        const name = safeAssetName(file.name);
        const extension = extname(name).toLowerCase();
        if (file.type !== allowedImageTypes.get(extension)) throw new Error("File type does not match its extension");
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!validImageSignature(bytes, extension)) throw new Error("Invalid image file");
        uploads.push({ name, bytes });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid image" }, { status: 400 });
      }
    }
    for (const upload of uploads) {
      await atomicWrite(join(assetDir, upload.name), upload.bytes);
    }
    const post = await readPost(slug);
    return json({ ok: true, assets: await listAssets(slug, post.type) });
  }
  const deleteAssetMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)\/assets\/(.+)$/);
  if (deleteAssetMatch && req.method === "DELETE") {
    await rm(join(blogDir, safeSlug(deleteAssetMatch[1]), "assets", safeAssetName(deleteAssetMatch[2])), { force: true });
    return json({ ok: true });
  }
  return json({ error: "Not found" }, { status: 404 });
}

async function listAssets(slug: string, type: ContentType = "blog") {
  const assetDir = join(blogDir, safeSlug(slug), "assets");
  if (!existsSync(assetDir)) return [];
  return (await readdir(assetDir)).map((name) => ({ name, url: `${publicPostPath(type, slug)}assets/${name}` }));
}

async function serveAsset(req: Request, pathname: string) {
  const match = pathname.match(/^\/(blog|projects)\/post\/([^/]+)\/assets\/(.+)$/);
  if (!match) return null;
  let post: Post;
  try {
    post = await readPost(match[2]);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const requestedType: ContentType = match[1] === "projects" ? "project" : "blog";
  const authed = validSession(req);
  if ((!post.published || post.type !== requestedType) && !authed) return new Response("Not found", { status: 404 });
  const file = Bun.file(join(blogDir, post.slug, "assets", safeAssetName(match[3])));
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, { headers: { ...securityHeaders(), "cache-control": post.published && post.type === requestedType ? "public, max-age=86400" : "private, no-store" } });
}

await ensureDirs();
await writeSite(await readSite());
await regenerateIndexes();

Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  maxRequestBodySize: 50 * 1024 * 1024,
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
      if (url.pathname === "/admin/new-post" && url.searchParams.has("edit")) return redirect(`/admin/edit-post/${safeSlug(url.searchParams.get("edit") ?? "")}`);
      if (url.pathname === "/admin/new-post") return htmlResponse(adminPage("new-post"));
      const adminEditPostRoute = url.pathname.match(/^\/admin\/edit-post\/([^/]+)\/?$/);
      if (adminEditPostRoute) {
        if (!validSession(req)) return redirect("/admin/home");
        try {
          const post = await readPost(adminEditPostRoute[1]);
          return htmlResponse(adminPage("edit-post", postEditorContent("edit", post)));
        } catch {
          return htmlResponse(notFoundPage(), { status: 404 });
        }
      }
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
      const adminDraftPreviewRoute = url.pathname.match(/^\/admin\/preview-draft\/([a-f0-9-]+)\/$/);
      if (adminDraftPreviewRoute) {
        if (!validSession(req)) return new Response("Not found", { status: 404 });
        const preview = adminPreviews.get(adminDraftPreviewRoute[1]);
        if (!preview || preview.expiresAt < Date.now()) {
          adminPreviews.delete(adminDraftPreviewRoute[1]);
          return htmlResponse(notFoundPage(), { status: 404 });
        }
        return htmlResponse(renderPost(preview.post), { headers: { "cache-control": "no-store" } });
      }
      if (url.pathname === "/" || url.pathname === "/index.html") return htmlResponse(renderHome(await readSite()));
      if (url.pathname === "/blog/") return htmlResponse(renderListing(await listPosts(false, "blog"), "blog"));
      if (url.pathname === "/projects/") return htmlResponse(renderListing(await listPosts(false, "project"), "project"));
      const oldPostRoute = url.pathname.match(/^\/blog\/posts\/([^/]+)\/$/);
      if (oldPostRoute) return redirect(`/blog/post/${safeSlug(oldPostRoute[1])}/`);
      const postRoute = url.pathname.match(/^\/blog\/post\/([^/]+)\/$/);
      if (postRoute) {
        if (!existsSync(join(blogDir, safeSlug(postRoute[1]), "index.md"))) {
          return new Response("Not found", { status: 404 });
        }
        const post = await readPost(postRoute[1]);
        if (post.type !== "blog" || (!post.published && !validSession(req))) return new Response("Not found", { status: 404 });
        return htmlResponse(renderPost(post));
      }
      const projectRoute = url.pathname.match(/^\/projects\/post\/([^/]+)\/$/);
      if (projectRoute) {
        if (!existsSync(join(blogDir, safeSlug(projectRoute[1]), "index.md"))) return new Response("Not found", { status: 404 });
        const post = await readPost(projectRoute[1]);
        if (post.type !== "project" || (!post.published && !validSession(req))) return new Response("Not found", { status: 404 });
        return htmlResponse(renderPost(post));
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
    }
  },
});
