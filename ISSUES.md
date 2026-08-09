# ISSUES.md — Admin Post Section Audit
> Audit of `/admin/post` (library) and `/admin/post/<slug>` (detail view)
> Files checked: `backend/server.ts`, `backend/lib/markdown.ts`, `frontend/public/admin.js`, `frontend/server.ts`, `frontend/public/styles.css`

---

## What Codex Did Well (Fixed Since Last Audit)

- [x] `serveAsset()` now checks `validSession()` before serving assets for unpublished drafts — draft asset XSS/access control fixed.
- [x] HMAC secret fallback in production is now blocked with `throw new Error(...)` if `NODE_ENV=production` and no secret is set.
- [x] XSS via `javascript:` links is now mitigated via `safeHref()` in `backend/lib/markdown.ts` — only `http:`, `https:`, `mailto:`, `/`, `#` allowed.
- [x] Admin back link in `/admin/post/<slug>` now correctly points to `/admin/post` (stays in admin). No longer exits to public `/blog/`.
- [x] Search dropdown now closes on click-outside via `document.addEventListener("click", ...)` in `admin.js`.
- [x] `markdown.ts` is extracted to `backend/lib/` — good modular separation.
- [x] Post detail view uses `.post-content` wrapper — visual fidelity with public blog is now correct.
- [x] `post-badge` labels ("Blog" / "Saved Draft") are now consistent between library and detail view.
- [x] Filter icon with dropdown (Blogs / Saved Drafts) replaces old inline filter buttons — cleaner toolbar.
- [x] Search is now purely a "type to search" dropdown (doesn't pollute main library list).
- [x] Admin nav is now proper `<a>` links (MPA routing), not JS tab switching — simpler and correct.

---

## 1. Critical Bugs

### 1.1 `/admin/post/<slug>` Auth Check is Wrong — Serves Page to Unauthenticated Users
**File**: [`backend/server.ts:492`](file:///C:/Users/Nayan/Desktop/personal-website/backend/server.ts#L490-L495)

```ts
const adminPostRoute = url.pathname.match(/^\/admin\/post\/([^/]+)\/?$/);
if (adminPostRoute) {
  if (!validSession(req)) return new Response(adminPage("posts"), { ... }); // ← BUG
  const post = await readPost(adminPostRoute[1]);
  return new Response(adminPage("post", adminPostContent(post)), { ... });
}
```

**Problem**: If the session is invalid, instead of returning a 302 redirect to `/admin/home` (or a 401/404), it returns the full admin page HTML (`adminPage("posts")`). This means:
- The unauthenticated visitor receives the admin page shell in the HTML response body.
- The `data-login` section is shown (login form) but the panel is `hidden` — the **page is visible** and not a clean redirect.
- More critically: The **post content is NOT shown** (since `adminPostContent(post)` is only called after `validSession` passes), but the fact that the URL `/admin/post/<slug>` returns HTTP 200 with admin HTML instead of 404/302 is an information leak that this slug exists.

**Fix**: Return a redirect to `/admin/home` or a `302` to `/admin/post` — not a full page.

```ts
if (!validSession(req)) return new Response(null, { status: 302, headers: { location: "/admin/home" } });
```

---

### 1.2 `/admin/post/<slug>` — Post Not Found Crashes Server (500)
**File**: [`backend/server.ts:493`](file:///C:/Users/Nayan/Desktop/personal-website/backend/server.ts#L493)

```ts
const post = await readPost(adminPostRoute[1]); // throws if slug doesn't exist
```

`readPost()` calls `readFile(...)` which throws an `ENOENT` error if the slug directory/file doesn't exist. This is caught by the outer `try/catch` and returns a JSON `{ error: "..." }` 500 response **with `Content-Type: application/json`** — but the browser was expecting HTML. The user sees a raw JSON error blob in the browser.

**Fix**: Catch this specifically and return a clean 404 HTML page or redirect.

```ts
try {
  const post = await readPost(adminPostRoute[1]);
  return new Response(adminPage("post", adminPostContent(post)), { ... });
} catch {
  return new Response("Not found", { status: 404 });
}
```

---

### 1.3 Filter State Does Not Apply to the Library List
**File**: [`frontend/public/admin.js:104-107`](file:///C:/Users/Nayan/Desktop/personal-website/frontend/public/admin.js#L104-L107) and [`admin.js:243-246`](file:///C:/Users/Nayan/Desktop/personal-website/frontend/public/admin.js#L243-L246)

```js
// loadPosts always loads ALL posts regardless of active filters
async function loadPosts() {
  postState.posts = await api("/api/admin/posts?filter=all"); // hardcoded "all"
  renderLibrary();
}

// Toggling a filter only updates the search dropdown, not the library
if (button?.dataset.filter) {
  toggleFilter(button.dataset.filter);
  await loadSearchMatches(); // ← only refreshes search results, not the library
  return;
}
```

**Problem**: The library always shows all posts. The filters (Blogs / Saved Drafts) only affect the search dropdown results, not the main post list. The user selects "Blogs" filter and the main list still shows drafts. This is a confusing UX — filters appear to do nothing visible on the library.

**Fix**: When a filter changes, also reload the library with the active filter applied.

---

### 1.4 New Post Editor (`/admin/new-post`) is a Stub Placeholder
**File**: [`backend/server.ts:365`](file:///C:/Users/Nayan/Desktop/personal-website/backend/server.ts#L364-L366)

```ts
: page === "new-post"
  ? `<section class="admin-section"><div class="posts-admin"><p class="admin-muted">New post editor will live here next.</p></div></section>`
```

The **New Post** tab in the nav renders a placeholder paragraph. Clicking "New Post" from the nav goes to `/admin/new-post` which shows no functional editor. This means:
- There is currently no way to write or create a new post from the admin UI.
- The requirement for boilerplate title/slug/description and a Save Draft / Publish flow is completely absent.

---

## 2. UX Issues

### 2.1 `/admin/post` Library — No Edit/Download/Delete Actions on Post Cards
**File**: [`backend/server.ts:354-363`](file:///C:/Users/Nayan/Desktop/personal-website/backend/server.ts#L354-L363) / [`admin.js:132-140`](file:///C:/Users/Nayan/Desktop/personal-website/frontend/public/admin.js#L132-L140)

The post library cards only have the post **title as a link** and a **badge**. There are no row-level action buttons (Edit, Download, Delete). To take any action on a post, the user must click through to the detail page first.

The original requirement specified Edit / Download / Delete should be accessible directly from the library list. This extra navigation step (library → detail → action) is unnecessary friction.

**Note**: This is an architectural choice (detail page for actions) — it's acceptable if intentional, but it breaks the requirement. The detail page `/admin/post/<slug>` does correctly show the 3 icon buttons. However, for quick operations (delete/download), the user has to navigate to the detail page unnecessarily.

---

### 2.2 `/admin/post/<slug>` — Delete Button is Shown for Draft Posts
**File**: [`backend/server.ts:342`](file:///C:/Users/Nayan/Desktop/personal-website/backend/server.ts#L342)

```ts
<button type="button" class="icon-button danger" data-detail-delete="${post.slug}" ...>
```

The delete button is always rendered for every post — both published and unpublished drafts. The original requirement states:

> "there should also be delete button that should only come up for published post only not unpublished one"

**Fix**: Conditionally render the delete button only when `post.published === true`.

---

### 2.3 Search Dropdown Shows 3 Items Max Due to CSS Height Cap
**File**: [`frontend/public/styles.css:829`](file:///C:/Users/Nayan/Desktop/personal-website/frontend/public/styles.css#L829)

```css
.post-search-menu {
    max-height: 132px;
    overflow: auto;
}
```

At ~38px per item plus padding, `132px` height holds roughly **3 visible items**. The requirement specified "showing latest 5 posts at a time" in the dropdown.

**Fix**: Increase `max-height` to approximately `220px` to accommodate 5 items comfortably.

---

### 2.4 Filter Dropdown Has No Applied State on the Library
The filter icon badge shows the count of active filters, but the main library list ignores them (see Issue 1.3). This means the badge creates a false signal — the user sees "1 filter active" but the list is unchanged. This is misleading UX.

---

### 2.5 `/admin/post/<slug>` — No Preview Button on Detail View
The detail view (`adminPostContent`) renders Edit, Download, Delete icon buttons but has **no Preview button**. The requirement says preview should open a new tab as the page would look when published. Previewing is not accessible from the detail view at all.

---

## 3. Security (Remaining)

### 3.1 Admin Password Falls Back to Hardcoded String in Dev
**File**: [`backend/server.ts:385`](file:///C:/Users/Nayan/Desktop/personal-website/backend/server.ts#L385)

```ts
if (password !== (process.env.ADMIN_PASSWORD || "admin")) return unauthorized();
```

Login validation still falls back to `"admin"` when `ADMIN_PASSWORD` is not set. While the HMAC secret now throws in production, this login check does not — meaning `bun server.ts` with no env vars accepts `"admin"` as a valid password in any environment. Acceptable for local dev only, but should log a warning.

---

### 3.2 `inlineMarkdown` Inline Code Does Not Escape After Label Escaping
**File**: [`backend/lib/markdown.ts:35-38`](file:///C:/Users/Nayan/Desktop/personal-website/backend/lib/markdown.ts#L35-L38)

```ts
out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => `<a href="${safeHref(href)}">${label}</a>`);
```

`label` in anchor text comes from the post-escape (`escapeHtml`) pass on the full line, but then the regex captures the already-escaped `label` fragment and injects it literally into the `<a>` tag. This is **safe** as-is because `escapeHtml` has already run on the full line. However, the ordering is fragile — if the regex order ever changes (e.g. bold/italic before link), it could re-introduce injection via partially-processed content. Should be documented or restructured to be order-independent.

---

## 4. Remaining Architectural Note

### 4.1 `backend/server.ts` Still 519 Lines with Mixed Concerns
The partial modularization (extracting `markdown.ts`) is good progress but `server.ts` still mixes routing, HTML template strings, auth, file ops, and post logic. Further extraction into `lib/posts.ts`, `lib/templates.ts`, and `lib/auth.ts` would make future changes safer and easier to reason about. Not urgent, but should be tracked.

---

## Summary Table

| # | Route | Severity | Issue |
|---|-------|----------|-------|
| 1.1 | `/admin/post/<slug>` | 🔴 Critical | Unauthenticated request returns 200 + admin HTML instead of 302/404 |
| 1.2 | `/admin/post/<slug>` | 🔴 Critical | Unknown slug crashes with JSON 500 response instead of HTML 404 |
| 1.3 | `/admin/post` | 🔴 Critical | Filter toggles don't affect the library list — hardcoded `filter=all` |
| 1.4 | `/admin/new-post` | 🔴 Critical | New post editor is a stub placeholder — not implemented |
| 2.1 | `/admin/post` | 🟠 High | No row-level Edit/Download/Delete actions on library cards |
| 2.2 | `/admin/post/<slug>` | 🟠 High | Delete button shown for draft posts (requirement: published only) |
| 2.3 | `/admin/post` | 🟡 Medium | Search dropdown capped at ~3 visible items; requirement says 5 |
| 2.4 | `/admin/post` | 🟡 Medium | Filter badge shows count but library is unfiltered — misleading UX |
| 2.5 | `/admin/post/<slug>` | 🟡 Medium | No Preview button on detail view |
| 3.1 | All | 🟡 Medium | Login check still falls back to `"admin"` in non-production |
| 3.2 | All | 🟢 Low | `inlineMarkdown` regex ordering is fragile (safe now, risky to change) |
| 4.1 | Backend | 🟢 Low | `server.ts` still 519 lines — further modularization recommended |
