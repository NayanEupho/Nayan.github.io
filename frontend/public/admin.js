const $ = (selector) => document.querySelector(selector);
const login = $("[data-login]");
const panel = $("[data-panel]");
const page = panel?.dataset.adminPage || login?.dataset.adminPage || "home";
const postState = {
  filters: new Set(),
  posts: [],
  matches: [],
  searchOpen: false,
  filterOpen: false,
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body instanceof FormData ? {} : { "content-type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return res.json();
}

function setAuthed(authed) {
  login.hidden = authed;
  panel.hidden = !authed;
}

async function boot() {
  try {
    await api("/api/admin/session");
    setAuthed(true);
    if (page === "home") await loadSite();
    if (page === "posts") {
      renderFilterMenu();
      await loadPosts();
    }
  } catch {
    setAuthed(false);
  }
}

$("[data-login-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: event.target.password.value }),
    });
    setAuthed(true);
    if (page === "home") await loadSite();
    if (page === "posts") {
      renderFilterMenu();
      await loadPosts();
    }
  } catch (error) {
    $("[data-login-error]").textContent = error.message;
  }
});

$("[data-logout]").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  setAuthed(false);
});

async function loadSite() {
  const form = $("[data-site-form]");
  if (!form) return;
  const site = await api("/api/admin/site");
  form.name.value = site.name;
  form.subtitle.value = site.subtitle;
  form.location.value = site.location;
  form.timezone.value = site.timezone;
  form.github.value = site.links.github;
  form.twitter.value = site.links.twitter;
  form.email.value = site.links.email;
  form.resume.value = site.links.resume;
  form.bio.value = site.bio.join("\n\n");
}

$("[data-site-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  await api("/api/admin/site", {
    method: "PUT",
    body: JSON.stringify({
      name: form.name.value,
      subtitle: form.subtitle.value,
      avatar: "/pfp.jpg",
      location: form.location.value,
      timezone: form.timezone.value,
      bio: form.bio.value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
      links: {
        blog: "/blog/",
        press: "/press/",
        github: form.github.value,
        twitter: form.twitter.value,
        email: form.email.value,
        resume: form.resume.value,
      },
    }),
  });
});

async function loadPosts() {
  postState.posts = await api("/api/admin/posts?filter=all");
  renderLibrary();
}

async function loadSearchMatches() {
  const search = $("[data-post-search]")?.value.trim() || "";
  if (!search) {
    postState.matches = [];
    postState.searchOpen = false;
    renderSearchMenu();
    return;
  }

  const filters = [...postState.filters];
  const filter = filters.length === 1 ? filters[0] : "all";
  postState.matches = await api(`/api/admin/posts?${new URLSearchParams({ filter, q: search })}`);
  postState.searchOpen = Boolean(postState.matches.length);
  renderSearchMenu();
}

function postBadge(post) {
  return `<span class="post-badge ${post.published ? "published" : "draft"}">${post.published ? "Blog" : "Saved Draft"}</span>`;
}

function renderLibrary() {
  const library = $("[data-post-library]");
  if (!library) return;
  library.innerHTML = postState.posts.map((post) => `
    <article class="admin-blog-post" data-view-post="${post.slug}">
      <div>
        <p class="blog-date">${formatDate(post.date)}</p>
        <h2><a class="blog-post-title" href="/admin/post/${post.slug}">${escapeHtml(post.title)}</a>${postBadge(post)}</h2>
      </div>
    </article>
  `).join("") || `<p class="admin-muted">No posts found.</p>`;
}

function renderSearchMenu() {
  const menu = $("[data-post-search-menu]");
  if (!menu) return;
  const hasQuery = Boolean($("[data-post-search]")?.value.trim());
  menu.innerHTML = postState.matches.map((post) => `<button type="button" data-search-open="${post.slug}"><span>${escapeHtml(post.title)}</span>${postBadge(post)}</button>`).join("");
  menu.hidden = !postState.searchOpen || !hasQuery || !postState.matches.length;
}

function openPostPage(slug) {
  location.href = `/admin/post/${encodeURIComponent(slug)}`;
}

function filterLabel(filter) {
  return filter === "published" ? "Blogs" : "Saved Drafts";
}

function renderFilterMenu() {
  const menu = $("[data-filter-menu]");
  if (menu) {
    menu.innerHTML = `
      <div class="filter-menu-head">
        <span>Filters</span>
        <button type="button" class="clear-filter" data-clear-filters aria-label="Clear all filters" title="Clear all filters">&times;</button>
      </div>
      ${["published", "draft"].map((filter) => `
        <button type="button" data-filter="${filter}" class="${postState.filters.has(filter) ? "active" : ""}">
          <span>${filterLabel(filter)}</span>
          <span class="filter-check">&#10003;</span>
        </button>
      `).join("")}
    `;
  }

  const count = $("[data-filter-count]");
  const toggle = $("[data-filter-toggle]");
  const activeCount = postState.filters.size;
  if (count) {
    count.textContent = String(activeCount);
    count.hidden = activeCount === 0;
  }
  toggle?.classList.toggle("active", activeCount > 0);
}

function toggleFilter(filter) {
  if (postState.filters.has(filter)) postState.filters.delete(filter);
  else postState.filters.add(filter);
  renderFilterMenu();
}

function downloadPost(slug) {
  window.open(`/api/admin/posts/${slug}/download`, "_blank", "noopener");
}

function previewPost(slug) {
  window.open(`/admin/preview/${encodeURIComponent(slug)}/`, "_blank", "noopener");
}

async function deletePost(slug) {
  if (!confirm("Delete this post and all of its assets?")) return;
  if (!confirm("This cannot be undone. Delete it permanently?")) return;
  await api(`/api/admin/posts/${slug}`, { method: "DELETE" });
  location.href = "/admin/post";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

$("[data-post-search]")?.addEventListener("input", loadSearchMatches);
$("[data-post-search]")?.addEventListener("focus", loadSearchMatches);

$("[data-filter-toggle]")?.addEventListener("click", () => {
  postState.filterOpen = !postState.filterOpen;
  $("[data-filter-menu]").hidden = !postState.filterOpen;
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const article = event.target.closest("[data-view-post]");
  const insideSearch = event.target.closest(".post-search");
  const insideFilter = event.target.closest(".filter-wrap");

  if (!insideSearch && $("[data-post-search-menu]")) {
    postState.searchOpen = false;
    renderSearchMenu();
  }
  if (!insideFilter && $("[data-filter-menu]")) {
    postState.filterOpen = false;
    $("[data-filter-menu]").hidden = true;
  }

  if (button?.dataset.clearFilters !== undefined) {
    postState.filters.clear();
    renderFilterMenu();
    await loadSearchMatches();
    return;
  }
  if (button?.dataset.filter) {
    toggleFilter(button.dataset.filter);
    await loadSearchMatches();
    return;
  }
  if (button?.dataset.searchOpen) {
    postState.searchOpen = false;
    renderSearchMenu();
    return openPostPage(button.dataset.searchOpen);
  }
  if (button?.dataset.detailPreview) return previewPost(button.dataset.detailPreview);
  if (button?.dataset.detailEdit) {
    location.href = `/admin/new-post?edit=${encodeURIComponent(button.dataset.detailEdit)}`;
    return;
  }
  if (button?.dataset.detailDownload) return downloadPost(button.dataset.detailDownload);
  if (button?.dataset.detailDelete) return deletePost(button.dataset.detailDelete);
  if (article && !button) return openPostPage(article.dataset.viewPost);
});

boot();
