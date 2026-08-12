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
let toastTimer;
let slugCheckTimer;
let previewTimer;
let slugCheckVersion = 0;
let editorAssets = [];
let autocompleteIndex = 0;
let editorBaseline = null;
let searchTimer;

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body instanceof FormData ? {} : { "content-type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function showToast(message, type = "success") {
  let toast = $("[data-admin-toast]");
  if (!toast) {
    toast = document.createElement("div");
    toast.dataset.adminToast = "";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  clearTimeout(toastTimer);
  toast.className = `admin-toast ${type}`;
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("show"));
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.hidden = true;
    }, 260);
  }, 2600);
}

function flashToast(message, type = "success") {
  sessionStorage.setItem("adminToast", JSON.stringify({ message, type }));
}

function showFlashToast() {
  const raw = sessionStorage.getItem("adminToast");
  if (!raw) return;
  sessionStorage.removeItem("adminToast");
  try {
    const toast = JSON.parse(raw);
    showToast(toast.message, toast.type);
  } catch {
    showToast(raw);
  }
}

function setAuthed(authed) {
  login.hidden = authed;
  panel.hidden = !authed;
}

async function boot() {
  showFlashToast();
  try {
    await api("/api/admin/session");
    setAuthed(true);
    if (page === "home") await loadSite();
    if (page === "posts") {
      renderFilterMenu();
      await loadPosts();
    }
    if (page === "edit-post") await loadAssets();
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
    if (page === "edit-post") await loadAssets();
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
  const button = form.querySelector("button[type='submit']");
  const originalText = button?.textContent || "Save homepage";
  if (button) {
    button.disabled = true;
    button.textContent = "Publishing...";
  }

  try {
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
          projects: "/projects/",
          press: "/press/",
          github: form.github.value,
          twitter: form.twitter.value,
          email: form.email.value,
          resume: form.resume.value,
        },
      }),
    });
    showToast("Homepage saved and published");
    if (button) button.textContent = "Published";
    setTimeout(() => {
      if (button) button.textContent = originalText;
    }, 1400);
  } catch (error) {
    showToast(error.message || "Could not publish homepage", "error");
    if (button) button.textContent = originalText;
  } finally {
    if (button) button.disabled = false;
  }
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
  const term = search.toLocaleLowerCase();
  postState.matches = postState.posts.filter((post) => {
    const selectedTypes = filters.filter((filter) => filter === "blog" || filter === "project");
    if (selectedTypes.length && !selectedTypes.includes(post.type || "blog")) return false;
    if (postState.filters.has("draft") && post.published) return false;
    return post.title.toLocaleLowerCase().includes(term);
  });
  postState.searchOpen = Boolean(postState.matches.length);
  renderSearchMenu();
}

function scheduleSearchMatches() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadSearchMatches().catch((error) => showToast(error.message, "error")), 180);
}

function postBadge(post) {
  const type = post.type || "blog";
  const label = post.published ? (type === "project" ? "Project" : "Blog") : "Saved Draft";
  return `<span class="post-badge ${post.published ? `published ${type}` : "draft"}" data-post-type="${type}">${label}</span>`;
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
  if (filter === "blog") return "Blogs";
  if (filter === "project") return "Projects";
  return "Saved Drafts";
}

function renderFilterMenu() {
  const menu = $("[data-filter-menu]");
  if (menu) {
    menu.innerHTML = `
      <div class="filter-menu-head">
        <span>Filters</span>
        <button type="button" class="clear-filter" data-clear-filters aria-label="Clear all filters" title="Clear all filters">&times;</button>
      </div>
      ${["blog", "project", "draft"].map((filter) => `
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

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function postPublicPath(post) {
  const section = (post.type || "blog") === "project" ? "projects" : "blog";
  return `/${section}/post/${encodeURIComponent(post.slug)}/`;
}

function sanitizeSlugInput(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/g, "")
    .slice(0, 80);
}

function editorPayload(published) {
  const form = $("[data-post-editor]");
  return {
    title: form.title.value.trim(),
    slug: slugify(form.slug.value || form.title.value),
    date: form.date.value,
    description: form.description.value.trim(),
    markdown: form.markdown.value,
    type: form.elements.type.value,
    published,
    assetSlug: form.dataset.editorSlug || slugify(form.slug.value || form.title.value),
  };
}

function editorSnapshot() {
  const form = $("[data-post-editor]");
  if (!form) return "";
  return JSON.stringify({
    title: form.title.value,
    slug: slugify(form.slug.value),
    date: form.date.value,
    description: form.description.value,
    markdown: form.markdown.value,
    type: form.elements.type.value,
  });
}

function editorIsDirty() {
  return editorBaseline !== null && editorSnapshot() !== editorBaseline;
}

function updateEditActions() {
  const form = $("[data-post-editor]");
  if (!form || form.dataset.editorMode !== "edit") return;
  const busy = form.dataset.busy === "true";
  const slugAvailable = form.dataset.slugAvailable === "true";
  const dirty = editorIsDirty();
  const save = $("[data-edit-save]");
  const update = $("[data-edit-update]");
  const publish = $("[data-edit-publish]");
  const state = $("[data-editor-save-state]");

  if (save) save.disabled = busy || !slugAvailable || !dirty;
  if (update) update.disabled = busy || !slugAvailable || !dirty;
  if (publish) {
    publish.disabled = busy || !slugAvailable;
    publish.classList.toggle("blocked", dirty && !busy && slugAvailable);
    publish.setAttribute("aria-disabled", String(dirty));
  }
  if (state) {
    state.textContent = dirty ? "Unsaved changes" : "All changes saved";
    state.classList.toggle("dirty", dirty);
  }
}

function captureEditorBaseline() {
  editorBaseline = editorSnapshot();
  updateEditActions();
}

function setEditorBusy(busy) {
  const form = $("[data-post-editor]");
  if (form) form.dataset.busy = String(busy);
  document.querySelectorAll("[data-editor-save-draft], [data-editor-publish], [data-editor-final-preview]").forEach((button) => {
    button.disabled = busy || form?.dataset.slugAvailable !== "true";
  });
  updateEditActions();
}

function setEditorStatus(label) {
  const tag = $("[data-editor-status-tag]");
  if (!tag) return;
  tag.textContent = label;
  tag.className = `editor-status-tag ${label.toLowerCase().replace(" ", "-")}`;
}

function transitionEditorToEdit(slug) {
  const heading = $("[data-editor-heading]");
  const copy = $("[data-editor-copy]");
  const back = $("[data-editor-back]");
  if (heading) heading.textContent = "Edit Post";
  if (copy) copy.textContent = "Update this existing Markdown post.";
  if (back) {
    back.href = `/admin/post/${encodeURIComponent(slug)}`;
    back.textContent = "← Back to post";
  }
}

async function persistEditor(published, navigate = true) {
  const form = $("[data-post-editor]");
  if (!form) return null;
  const status = $("[data-editor-status]");
  const mode = form.dataset.editorMode;
  const originalSlug = form.dataset.editorSlug;
  if (status) status.textContent = "";

  const payload = editorPayload(published);
  const path = mode === "edit" ? `/api/admin/posts/${encodeURIComponent(originalSlug)}` : "/api/admin/posts";
  const method = mode === "edit" ? "PUT" : "POST";
  const post = await api(path, { method, body: JSON.stringify(payload) });
  form.dataset.editorMode = "edit";
  form.dataset.editorSlug = post.slug;
  form.dataset.editorType = post.type || "blog";
  transitionEditorToEdit(post.slug);
  setEditorStatus(published ? "Published" : "Saved Draft");
  if (navigate) {
    if (published) {
      showToast("Post published");
      setTimeout(() => {
        location.href = postPublicPath(post);
      }, 550);
    } else {
      flashToast("Draft saved");
      location.href = `/admin/edit-post/${encodeURIComponent(post.slug)}`;
    }
  } else {
    history.replaceState({}, "", `/admin/edit-post/${encodeURIComponent(post.slug)}`);
    await checkSlugAvailability();
  }
  return post;
}

async function saveEditor(published) {
  const status = $("[data-editor-status]");
  const button = published ? $("[data-editor-publish]") : $("[data-editor-save-draft]");
  const originalText = button?.textContent || "";
  setEditorBusy(true);
  if (button) button.textContent = published ? "Publishing..." : "Saving...";
  try {
    await persistEditor(published);
  } catch (error) {
    const message = error.message || "Could not save post";
    showToast(message, "error");
    if (status) status.textContent = message;
  } finally {
    setEditorBusy(false);
    if (button) button.textContent = originalText;
  }
}

function updateEditorLinks(post) {
  const form = $("[data-post-editor]");
  const back = $("[data-editor-back]");
  const live = $("[data-editor-live-link]");
  if (!form) return;
  form.dataset.editorSlug = post.slug;
  form.dataset.editorType = post.type || "blog";
  if (back) back.href = `/admin/post/${encodeURIComponent(post.slug)}`;
  if (live) live.href = postPublicPath(post);
  history.replaceState({}, "", `/admin/edit-post/${encodeURIComponent(post.slug)}`);
}

async function saveExistingPost() {
  const form = $("[data-post-editor]");
  const published = form?.dataset.editorPublished === "true";
  const button = published ? $("[data-edit-update]") : $("[data-edit-save]");
  if (!form || !editorIsDirty() || !(await checkSlugAvailability())) return;
  const originalText = button?.textContent || "";
  setEditorBusy(true);
  if (button) button.textContent = published ? "Updating..." : "Saving...";
  try {
    const post = await api(`/api/admin/posts/${encodeURIComponent(form.dataset.editorSlug)}`, {
      method: "PUT",
      body: JSON.stringify(editorPayload(published)),
    });
    updateEditorLinks(post);
    captureEditorBaseline();
    showToast(published ? "Live post updated" : "Draft changes saved");
  } catch (error) {
    showToast(error.message || "Could not save changes", "error");
  } finally {
    setEditorBusy(false);
    if (button) button.textContent = originalText;
  }
}

async function publishExistingDraft() {
  const form = $("[data-post-editor]");
  if (!form) return;
  if (editorIsDirty()) {
    showToast("Save your changes before publishing", "error");
    return;
  }
  if (!(await checkSlugAvailability())) return;
  const button = $("[data-edit-publish]");
  const originalText = button?.textContent || "";
  setEditorBusy(true);
  if (button) button.textContent = "Publishing...";
  try {
    const post = await api(`/api/admin/posts/${encodeURIComponent(form.dataset.editorSlug)}/publish`, { method: "POST" });
    form.dataset.editorPublished = "true";
    setEditorStatus("Published");
    showToast("Post published");
    setTimeout(() => {
      location.href = postPublicPath(post);
    }, 550);
  } catch (error) {
    showToast(error.message || "Could not publish post", "error");
    setEditorBusy(false);
    if (button) button.textContent = originalText;
  }
}

async function loadAssets() {
  const form = $("[data-post-editor]");
  const list = $("[data-assets]");
  if (!form || !list || !form.dataset.editorSlug) return;
  const post = await api(`/api/admin/posts/${encodeURIComponent(form.dataset.editorSlug)}`);
  renderAssets(post.assets || []);
}

function renderAssets(assets) {
  const list = $("[data-assets]");
  if (!list) return;
  editorAssets = assets;
  list.innerHTML = assets.map((asset) => `
    <div class="asset-row">
      <img src="${escapeHtml(asset.url)}" alt="" loading="lazy">
      <button type="button" class="asset-reference" data-insert-asset="${escapeHtml(asset.name)}" title="Insert this image"><code>assets/${escapeHtml(asset.name)}</code></button>
      <button type="button" class="icon-button danger" data-delete-asset="${escapeHtml(asset.name)}" aria-label="Delete asset" title="Delete asset">Delete</button>
    </div>
  `).join("") || `<p class="admin-muted">No assets uploaded yet.</p>`;
  updateAssetAutocomplete();
}

async function ensureEditorDraft() {
  const form = $("[data-post-editor]");
  if (!form) throw new Error("Editor is unavailable");
  if (form.dataset.editorMode === "edit") return { slug: form.dataset.editorSlug, created: false };
  const availability = await checkSlugAvailability();
  if (!availability) throw new Error("Choose an available slug before adding images");
  const post = await persistEditor(false, false);
  showToast("Draft saved so the image can be attached");
  return { slug: post.slug, created: true };
}

function imageFilename(file) {
  if (file.name && file.name !== "image.png") {
    const safeName = file.name.replace(/[^a-zA-Z0-9.@_-]/g, "-");
    return safeName.startsWith("@") ? safeName : `@${safeName}`;
  }
  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return `@pasted-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

function insertAtCursor(text) {
  const input = $("[data-markdown-input]");
  if (!input) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const before = input.value.slice(0, start);
  const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
  const suffix = input.value.slice(end) && !input.value.slice(end).startsWith("\n") ? "\n\n" : "";
  input.setRangeText(`${prefix}${text}${suffix}`, start, end, "end");
  input.focus();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function uploadAssets(files, insertMarkdown = false) {
  const form = $("[data-post-editor]");
  const images = [...files].filter((file) => file.type.startsWith("image/"));
  if (!form || !images.length) return;
  const draft = await ensureEditorDraft();
  const data = new FormData();
  const names = [];
  for (const file of images) {
    const name = imageFilename(file);
    names.push(name);
    data.append("asset", file, name);
  }
  const result = await api(`/api/admin/posts/${encodeURIComponent(draft.slug)}/assets`, {
    method: "POST",
    body: data,
  });
  renderAssets(result.assets || []);
  if (insertMarkdown) insertAtCursor(names.map((name) => `![Image description](assets/${name})`).join("\n\n"));
  if (draft.created) await persistEditor(false, false);
  showToast(images.length === 1 ? "Image added" : `${images.length} images added`);
}

function insertAssetMarkdown(name) {
  insertAtCursor(`![Image description](assets/${name})`);
}

function autocompleteMatch() {
  const input = $("[data-markdown-input]");
  if (!input) return null;
  const before = input.value.slice(0, input.selectionStart);
  const match = before.match(/assets\/@([^\s)]*)$/i);
  if (!match) return null;
  return {
    query: match[1].toLowerCase(),
    start: input.selectionStart - match[0].length,
    end: input.selectionStart,
  };
}

function autocompleteAssets(query) {
  return editorAssets
    .filter((asset) => asset.name.toLowerCase().replace(/^@/, "").includes(query))
    .slice(0, 5);
}

function updateAssetAutocomplete() {
  const menu = $("[data-asset-autocomplete]");
  const match = autocompleteMatch();
  if (!menu || !match || !editorAssets.length) {
    if (menu) menu.hidden = true;
    return;
  }
  const matches = autocompleteAssets(match.query);
  if (!matches.length) {
    menu.hidden = true;
    return;
  }
  autocompleteIndex = Math.min(autocompleteIndex, matches.length - 1);
  menu.innerHTML = matches.map((asset, index) => `
    <button type="button" class="${index === autocompleteIndex ? "active" : ""}" data-autocomplete-asset="${escapeHtml(asset.name)}">
      <img src="${escapeHtml(asset.url)}" alt=""><span><strong>${escapeHtml(asset.name)}</strong><small>assets/${escapeHtml(asset.name)}</small></span>
    </button>
  `).join("");
  menu.hidden = false;
}

function chooseAutocompleteAsset(name) {
  const input = $("[data-markdown-input]");
  const match = autocompleteMatch();
  if (!input || !match) return;
  const closesImage = input.value.slice(0, match.start).endsWith("](") && input.value[match.end] !== ")";
  input.setRangeText(`assets/${name}${closesImage ? ")" : ""}`, match.start, match.end, "end");
  input.focus();
  $("[data-asset-autocomplete]").hidden = true;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function deleteAsset(name) {
  const form = $("[data-post-editor]");
  if (!form?.dataset.editorSlug) return;
  await api(`/api/admin/posts/${encodeURIComponent(form.dataset.editorSlug)}/assets/${encodeURIComponent(name)}`, { method: "DELETE" });
  await loadAssets();
  showToast("Asset deleted");
}

async function deletePost(slug, kind = "post") {
  if (!confirm(`Delete this ${kind} and all of its assets?`)) return;
  if (!confirm(`This cannot be undone. Delete the ${kind} permanently?`)) return;
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

async function checkSlugAvailability(requestVersion = ++slugCheckVersion) {
  const form = $("[data-post-editor]");
  const field = form?.elements.slug;
  const status = $("[data-slug-status]");
  if (!form || !field || !status) return true;
  const slug = slugify(field.value);
  if (!slug) {
    status.textContent = "Enter a valid slug";
    status.className = "unavailable";
    form.dataset.slugAvailable = "false";
    setEditorBusy(form.dataset.busy === "true");
    return false;
  }
  const params = new URLSearchParams({ slug });
  if (form.dataset.editorSlug) params.set("current", form.dataset.editorSlug);
  try {
    const result = await api(`/api/admin/posts/slug-available?${params}`);
    if (requestVersion !== slugCheckVersion || slugify(field.value) !== result.slug) return false;
    status.textContent = result.available ? "Available" : "Already in use";
    status.className = result.available ? "available" : "unavailable";
    form.dataset.slugAvailable = String(result.available);
    setEditorBusy(form.dataset.busy === "true");
    return result.available;
  } catch {
    if (requestVersion !== slugCheckVersion) return false;
    status.textContent = "Could not check";
    status.className = "unavailable";
    form.dataset.slugAvailable = "false";
    setEditorBusy(form.dataset.busy === "true");
    return false;
  }
}

function scheduleSlugCheck() {
  const requestVersion = ++slugCheckVersion;
  const form = $("[data-post-editor]");
  const status = $("[data-slug-status]");
  if (status) {
    status.textContent = "Checking...";
    status.className = "";
  }
  if (form) {
    form.dataset.slugAvailable = "checking";
    setEditorBusy(form.dataset.busy === "true");
  }
  clearTimeout(slugCheckTimer);
  slugCheckTimer = setTimeout(() => checkSlugAvailability(requestVersion), 260);
}

function applyMarkdown(action) {
  const input = $("[data-markdown-input]");
  if (!input) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const selected = input.value.slice(start, end);
  const formats = {
    bold: ["**", "**", selected || "bold text"],
    italic: ["*", "*", selected || "italic text"],
    link: ["[", "](https://)", selected || "link text"],
    quote: ["> ", "", selected || "quoted text"],
    code: ["\n\n```txt\n", "\n```\n\n", selected || "code"],
  };
  const format = formats[action];
  if (!format) return;
  input.setRangeText(`${format[0]}${format[2]}${format[1]}`, start, end, "select");
  input.selectionStart = start + format[0].length;
  input.selectionEnd = start + format[0].length + format[2].length;
  input.focus();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderEditorPreview() {
  const form = $("[data-post-editor]");
  const rendered = $("[data-editor-rendered]");
  if (!form || !rendered) return;
  rendered.innerHTML = '<p class="admin-muted">Rendering preview...</p>';
  try {
    const result = await api("/api/admin/preview", {
      method: "POST",
      body: JSON.stringify({
        markdown: form.elements.markdown.value,
        slug: form.elements.slug.value,
        assetSlug: form.dataset.editorSlug || form.elements.slug.value,
        type: form.elements.type.value,
      }),
    });
    rendered.innerHTML = result.html || '<p class="admin-muted">Nothing to preview yet.</p>';
  } catch (error) {
    rendered.innerHTML = `<p class="admin-muted">${escapeHtml(error.message)}</p>`;
  }
}

function setEditorTab(tab) {
  const input = $("[data-markdown-input]");
  const rendered = $("[data-editor-rendered]");
  const tools = $(".markdown-tools");
  if (!input || !rendered) return;
  const previewing = tab === "preview";
  input.hidden = previewing;
  rendered.hidden = !previewing;
  if (tools) tools.hidden = previewing;
  document.querySelectorAll("[data-editor-tab]").forEach((button) => {
    const active = button.dataset.editorTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (previewing) renderEditorPreview();
}

async function openFinalPreview() {
  const previewWindow = window.open("about:blank", "_blank");
  setEditorBusy(true);
  try {
    const form = $("[data-post-editor]");
    const result = await api("/api/admin/previews", {
      method: "POST",
      body: JSON.stringify(editorPayload(form?.dataset.editorPublished === "true")),
    });
    const previewUrl = `/admin/preview-draft/${encodeURIComponent(result.id)}/`;
    if (previewWindow) previewWindow.location.href = previewUrl;
    else location.href = previewUrl;
  } catch (error) {
    previewWindow?.close();
    showToast(error.message || "Could not open preview", "error");
  } finally {
    setEditorBusy(false);
  }
}

$("[data-post-search]")?.addEventListener("input", scheduleSearchMatches);
$("[data-post-search]")?.addEventListener("focus", () => loadSearchMatches().catch((error) => showToast(error.message, "error")));

const editorForm = $("[data-post-editor]");
const editorTitle = editorForm?.elements.title;
const editorSlug = editorForm?.elements.slug;
let slugTouched = false;
editorSlug?.addEventListener("input", () => {
  slugTouched = true;
  editorSlug.value = sanitizeSlugInput(editorSlug.value);
  scheduleSlugCheck();
});
editorSlug?.addEventListener("blur", () => {
  editorSlug.value = slugify(editorSlug.value);
  scheduleSlugCheck();
});
editorTitle?.addEventListener("input", () => {
  if (editorForm?.dataset.editorMode === "new" && !slugTouched) {
    editorSlug.value = slugify(editorTitle.value);
    scheduleSlugCheck();
  }
});
$("[data-editor-save-draft]")?.addEventListener("click", () => saveEditor(false));
$("[data-editor-publish]")?.addEventListener("click", () => saveEditor(true));
$("[data-edit-save]")?.addEventListener("click", saveExistingPost);
$("[data-edit-update]")?.addEventListener("click", saveExistingPost);
$("[data-edit-publish]")?.addEventListener("click", publishExistingDraft);
$("[data-editor-final-preview]")?.addEventListener("click", openFinalPreview);
$("[data-asset-input]")?.addEventListener("change", (event) => uploadAssets(event.target.files, false).catch((error) => showToast(error.message, "error")));
$("[data-pick-image]")?.addEventListener("click", () => $("[data-asset-input]")?.click());
$("[data-markdown-input]")?.addEventListener("paste", async (event) => {
  const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
  if (!images.length) return;
  event.preventDefault();
  try {
    await uploadAssets(images, true);
  } catch (error) {
    showToast(error.message || "Could not paste image", "error");
  }
});
$("[data-markdown-input]")?.addEventListener("input", () => {
  autocompleteIndex = 0;
  updateAssetAutocomplete();
  if (!$("[data-editor-rendered]")?.hidden) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderEditorPreview, 220);
  }
});
$("[data-markdown-input]")?.addEventListener("keydown", (event) => {
  const menu = $("[data-asset-autocomplete]");
  const match = autocompleteMatch();
  if (!menu || menu.hidden || !match) return;
  const matches = autocompleteAssets(match.query);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    autocompleteIndex = (autocompleteIndex + direction + matches.length) % matches.length;
    updateAssetAutocomplete();
  } else if (event.key === "Enter" && matches[autocompleteIndex]) {
    event.preventDefault();
    chooseAutocompleteAsset(matches[autocompleteIndex].name);
  } else if (event.key === "Escape") {
    menu.hidden = true;
  }
});
$("[data-editor-workbench]")?.addEventListener("dragover", (event) => {
  if (![...event.dataTransfer.items].some((item) => item.type.startsWith("image/"))) return;
  event.preventDefault();
  event.currentTarget.classList.add("dragging");
});
$("[data-editor-workbench]")?.addEventListener("dragleave", (event) => event.currentTarget.classList.remove("dragging"));
$("[data-editor-workbench]")?.addEventListener("drop", async (event) => {
  event.currentTarget.classList.remove("dragging");
  const images = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
  if (!images.length) return;
  event.preventDefault();
  try {
    await uploadAssets(images, true);
  } catch (error) {
    showToast(error.message || "Could not add image", "error");
  }
});
document.querySelectorAll("[data-markdown-action]").forEach((button) => button.addEventListener("click", () => applyMarkdown(button.dataset.markdownAction)));
document.querySelectorAll("[data-editor-tab]").forEach((button) => button.addEventListener("click", () => setEditorTab(button.dataset.editorTab)));
editorForm?.addEventListener("submit", (event) => event.preventDefault());
editorForm?.addEventListener("input", updateEditActions);
window.addEventListener("beforeunload", (event) => {
  if (editorForm?.dataset.editorMode !== "edit" || !editorIsDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});
if (editorForm) {
  captureEditorBaseline();
  checkSlugAvailability();
}

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
    postState.filterOpen = false;
    $(`[data-filter-menu]`).hidden = true;
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
    location.href = `/admin/edit-post/${encodeURIComponent(button.dataset.detailEdit)}`;
    return;
  }
  if (button?.dataset.detailDownload) return downloadPost(button.dataset.detailDownload);
  if (button?.dataset.detailDelete) return deletePost(button.dataset.detailDelete, button.dataset.detailKind);
  if (button?.dataset.insertAsset) return insertAssetMarkdown(button.dataset.insertAsset);
  if (button?.dataset.autocompleteAsset) return chooseAutocompleteAsset(button.dataset.autocompleteAsset);
  if (button?.dataset.deleteAsset) return deleteAsset(button.dataset.deleteAsset);
  if (article && !button) return openPostPage(article.dataset.viewPost);
});

boot();
