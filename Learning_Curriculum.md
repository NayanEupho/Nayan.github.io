# Learning Curriculum: From Clone to Production System

## Current Stage

The project is no longer only a static clone. It is now a working content-publishing system with:

- Pixel-focused Home, Blog, Project, and article pages.
- Responsive dark and light themes with self-hosted fonts.
- A Bun frontend server and Bun backend server.
- An authenticated `/admin` interface.
- Markdown authoring, drafts, publishing, editing, deletion, previews, and image assets.
- Public Blog and Project routes with one globally unique slug per post.
- Docker Compose services for the frontend, backend, and SQLite container.
- Security headers, signed sessions, origin checks, login throttling, and protected draft assets.

The frontend-cloning and local full-stack phases are complete. The current learning goal is to understand the system end to end, make its behavior testable, and prepare it for reliable production deployment.

## Learning Method

Use first-principles and Socratic learning throughout each module:

- First principles: identify the bytes, process, protocol, state, and trust boundary involved.
- Socratic questions: explain why the current design works before changing it.
- Practical proof: verify each explanation with a command, browser inspection, or focused code change.

Do not add a framework or abstraction unless it removes demonstrated complexity.

## Phase 1: Completed Foundations

### Module 1: Browser Rendering and Pixel Accuracy

**Implemented:** semantic HTML, modular CSS, local fonts, responsive layouts, rounded article media, code blocks, gradients, and theme transitions.

Study:

- How HTML structure and CSS cascade produce the final layout.
- Why `shared.css`, `site.css`, `content.css`, `admin.css`, and `editor.css` load in a specific order.
- How breakpoints affect Home, listing, article, and admin layouts.
- Why font files, line height, spacing, and container widths matter for visual fidelity.

Questions:

- Which styles are global, and which belong to one interface?
- What causes horizontal overflow on mobile?
- Why can two visually centered elements require different mathematical alignment?

Exercise:

1. Inspect Home, Blog, an article, and Admin at desktop and mobile widths.
2. Toggle light and dark modes.
3. Confirm there are no failed assets, console errors, or horizontal overflow.

### Module 2: HTTP and the Two Bun Servers

**Implemented:** the frontend listens on port `3000`; the backend listens on port `3001` and handles dynamic pages and APIs.

Study:

- The request and response lifecycle through `frontend/server.ts`.
- Which paths are proxied to the backend and which files are served directly.
- HTTP methods, status codes, redirects, headers, cookies, and MIME types.
- Why `/blog/posts/<slug>/` redirects to `/blog/post/<slug>/`.

Questions:

- Why does the browser only need to know port `3000`?
- What changes when `API_URL` points to a Docker service name?
- Why should malformed paths return `404` instead of exposing the filesystem?

Exercise:

Use browser DevTools and PowerShell to trace requests for `/`, `/projects/`, an article asset, and `/api/admin/session`.

### Module 3: Content as Files

**Implemented:** `content/site.json` stores homepage content, while each post lives under `content/blog/<slug>/` with `index.md` and its own `assets/` directory.

Study:

- Frontmatter parsing and serialization.
- Markdown-to-HTML conversion and HTML escaping.
- Blog versus Project type, independent of draft versus published state.
- Atomic writes, slug validation, global uniqueness, and generated public HTML.
- Why generated HTML is an output and must not be edited as the source of truth.

Questions:

- What prevents two posts from claiming the same slug?
- What must happen when a published Project becomes a Blog?
- Why are draft assets private even though published assets are cacheable?

Exercise:

Create a draft, upload an image, preview it, publish it as a Project, convert it to a Blog, and verify that the old public route disappears.

### Module 4: Admin Authentication and Security Boundaries

**Implemented:** environment-based password configuration, signed `HttpOnly` cookies, same-site protection, origin checks, login throttling, and protected admin previews.

#### Authentication model used by this project

The admin uses a **stateless signed-cookie session**. The server authenticates the login and validates the session on later requests, but it does not store or track an individual session record in memory or SQLite.

The `admin_session` cookie contains two values:

```text
<expiration timestamp>.<HMAC signature>
```

The signature is derived from the expiration timestamp and `ADMIN_SESSION_SECRET`. It proves that the server created the cookie and that the client has not changed its expiration value. The payload is signed, not encrypted; anyone who obtains the cookie can read the timestamp, but cannot create a valid replacement without the secret.

#### Complete login and request flow

1. The browser loads `/admin` and receives the login interface.
2. JavaScript sends `POST /api/admin/login` with a JSON body containing the entered password.
3. The frontend server proxies the request to the backend.
4. The backend validates the request origin before processing the mutation.
5. The backend checks whether the requesting IP is temporarily blocked by login throttling.
6. The submitted password is compared with `ADMIN_PASSWORD` using a timing-resistant comparison.
7. If the password is wrong, the backend records the failed attempt and returns `401`, or `429` after too many failures.
8. If the password is correct, the backend creates a seven-day expiration timestamp and signs it with HMAC.
9. The response sends the signed value in an `admin_session` cookie with `HttpOnly`, `SameSite=Strict`, `Path=/`, and `Max-Age=604800`. It also uses `Secure` when the configured origin is HTTPS.
10. The browser stores the cookie automatically. Client JavaScript cannot read it because it is `HttpOnly`.
11. For later requests such as `GET /api/admin/posts`, the browser automatically includes the cookie in the request.
12. The backend extracts the cookie, rejects it if it is missing or expired, recomputes the expected signature, and compares the signatures in constant time.
13. A valid signature allows the protected request to continue. An invalid session returns `401`.

The password is sent only during login. Subsequent requests prove authentication with the signed cookie, not by resending the password.

#### Logout, expiration, restart, and revocation

- Logout sends `POST /api/admin/logout`; the response expires the browser cookie with `Max-Age=0`.
- Reaching the embedded expiration timestamp makes the cookie invalid even if the browser still sends it.
- Restarting the backend does not invalidate existing cookies because no per-session state is stored in process memory.
- Changing `ADMIN_SESSION_SECRET` invalidates every existing admin session because their signatures no longer match.
- One stolen cookie cannot currently be revoked individually. Individual revocation would require server-side session state or a revocation list.

Login throttling is server-tracked temporary state, but it is not session storage. The server remembers recent failed attempts by IP to slow brute-force attacks; it still does not keep a record for each successful login.

#### Stateless cookie versus server-tracked session

| Concern | Current stateless signed cookie | Server-tracked session |
| --- | --- | --- |
| Cookie contains | Expiration and signature | Random opaque session ID |
| Server stores each login | No | Yes, in memory, SQLite, Redis, or another store |
| Request validation | Verify expiry and HMAC signature | Look up the session ID and inspect its record |
| Survives server restart | Yes, if the secret is unchanged | Only if the session store persists |
| Individual revocation | Not directly | Delete or disable one session record |
| Revoke all sessions | Rotate `ADMIN_SESSION_SECRET` | Delete all records or rotate signing credentials |
| Horizontal scaling | Simple when all instances share the secret | Requires a shared session store or sticky sessions |
| Server-side metadata | Minimal | Can track user, device, IP, activity, and permissions |

A server-tracked flow would differ after password verification:

1. The server generates a cryptographically random session ID.
2. It stores a record such as `{ sessionId, userId, expiresAt, createdAt }`.
3. The browser receives only the opaque session ID in its cookie.
4. Every protected request causes the server to query the session store.
5. Logout or administrator action can delete that exact record immediately.

The current stateless design is appropriate for one administrator and keeps the implementation small. A tracked session store becomes useful when the project needs multiple users, per-device logout, individual revocation, audit history, or role-based access.

Study:

- Password configuration through `.env` and why secrets do not belong in Git.
- HMAC-signed sessions and constant-time comparisons.
- The difference between authentication, authorization, and session validation.
- Stateless signed cookies versus opaque server-stored session IDs.
- Cookie attributes: `HttpOnly`, `SameSite`, `Secure`, `Path`, and `Max-Age`.
- CSRF, XSS, path traversal, unsafe uploads, and brute-force attempts.
- Content Security Policy and other response security headers.

Questions:

- Why is a signed cookie not the same as an encrypted cookie?
- Which session information does this server remember after a successful login?
- Why does restarting the backend preserve login while rotating the secret logs everyone out?
- When would individual session revocation justify adding a session store?
- Why must state-changing requests validate their origin?
- Which uploaded bytes are trusted, and which are validated?

Exercise:

1. Log in while inspecting the Network panel and identify the password request, `Set-Cookie` response, and later automatic `Cookie` request header.
2. Confirm JavaScript cannot read `admin_session` through `document.cookie`.
3. Restart the backend without changing `ADMIN_SESSION_SECRET` and verify that the session remains valid.
4. Attempt an unauthenticated draft preview, a duplicate slug, an invalid image, and a cross-origin mutation. Record the expected status for each request.

## Phase 2: Current Focus

### Module 5: Automated Regression Testing

**Status:** manual route, API, and visual checks exist; repeatable automated coverage is the next priority.

Learn:

- Unit tests for slug normalization, frontmatter, Markdown rendering, and input validation.
- Integration tests for authentication and post lifecycle APIs.
- Browser tests for Home, Blog, Projects, articles, filters, editor controls, and themes.
- Disposable test data and guaranteed cleanup.

Deliverable:

Create a small Bun test suite that proves:

1. Legacy posts without a type default to Blog.
2. Duplicate slugs return `409`.
3. Draft pages and assets return `404` without authentication.
4. Publishing and type conversion update canonical routes and both indexes.
5. Core pages have no horizontal overflow at desktop and mobile widths.

Completion criterion:

One command runs the tests without modifying real content or leaving temporary files.

### Module 6: Observability and Failure Handling

**Status:** health endpoints and Docker health checks exist; structured operational visibility is still limited.

Learn:

- The difference between logs, metrics, traces, and health checks.
- Startup, readiness, and liveness failures.
- Useful request metadata that does not expose secrets or post bodies.
- How to diagnose frontend proxy failures, filesystem permission errors, and unavailable volumes.

Deliverable:

- Add concise structured logs for startup, authentication failures, and content mutations.
- Document a backup and restore check for `content/` and the SQLite volume.
- Confirm logs never contain passwords, session cookies, or private Markdown.

## Phase 3: Production Readiness

### Module 7: Containers and Persistent State

**Implemented:** Docker Compose defines frontend, backend, and database services with health checks and shared volumes.

Important current truth:

- Homepage and post content are stored in mounted JSON/Markdown files.
- SQLite is containerized and health-checked, but it is not currently the source of truth for posts.

Study:

- Images, containers, services, networks, bind mounts, and named volumes.
- Why the frontend reaches `http://backend:3001` inside Compose.
- Ownership and permissions for `/content`, `/public`, and `/data`.
- What survives `docker compose down`, rebuilds, and host restarts.

Exercise:

1. Start the stack with `docker compose up --build`.
2. Publish a temporary draft.
3. Rebuild and restart the stack.
4. Verify that content persists and health checks return healthy.

Optional extension:

Use SQLite for metadata only if it solves a concrete requirement such as revisions, audit history, concurrent writers, or indexed search. Do not migrate merely to increase architectural complexity.

### Module 8: HTTPS, Reverse Proxy, and Domain Routing

**Status:** not yet implemented in production.

Study:

- DNS `A`, `AAAA`, and `CNAME` records.
- TLS certificates and certificate authorities.
- Reverse proxies, TLS termination, forwarded headers, and trusted proxies.
- Why only ports `80` and `443` should be public.

Recommended exercise:

1. Deploy the Compose stack to a small VPS.
2. Keep backend port `3001` internal.
3. Put Caddy or Nginx in front of port `3000`.
4. Point a domain to the VPS.
5. Set `APP_ORIGIN` to the final HTTPS origin.
6. Verify secure cookies, redirects, assets, and admin mutations over HTTPS.

### Module 9: Backups, Updates, and Recovery

**Status:** required before treating the site as production-ready.

Study:

- The difference between source control and content backups.
- Recovery point objective and recovery time objective.
- Safe deployment, rollback, and schema migration practices.

Deliverable:

- Back up `content/`, `.env` through a secure secret store, and the SQLite volume if it gains real application data.
- Restore into a clean environment and verify public pages plus admin access.
- Document dependency updates and rollback commands.

## Phase 4: Optional Improvements

Only begin these after tests and deployment are reliable:

- Revision history and draft autosave.
- Search indexing beyond title matching.
- Multiple admin users and role-based permissions.
- Image resizing and responsive image variants.
- Content migrations and database-backed audit history.
- CI that runs type checks, tests, and container builds.

Each improvement must answer three questions:

1. Which current problem does it solve?
2. What is the smallest implementation that solves it?
3. How will tests prove that it works?

## Definition of Project Completion

The project is production-ready when:

- The public and admin workflows are visually verified on desktop and mobile.
- Type checks and automated tests pass from one documented command.
- Docker services start healthy from a clean checkout.
- HTTPS and the production origin are configured correctly.
- Drafts and private assets remain inaccessible without authentication.
- Content and application state can be backed up and restored.
- Deployment and rollback are documented and rehearsed.

Until those conditions are met, the project should be described as a complete local publishing system that is preparing for production deployment.
