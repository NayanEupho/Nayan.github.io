# Deployment Readiness

## Current Status

The website is suitable for local development and staging. Do not expose the
admin interface to the public internet until every required item below is
complete.

`docker compose config --quiet` passes, but a full production image build and
runtime smoke test must still be completed with the Docker Linux engine running.

## Required Before Public Deployment

### 1. Put the Website Behind HTTPS

Use a reverse proxy or hosting platform that provides TLS, such as Caddy, Nginx,
Cloudflare, or a managed container host. Public traffic must use HTTPS because
the admin password and session cookie must never travel over plain HTTP.

Only the public proxy should accept internet traffic. Keep the backend internal,
and avoid exposing port `3000` directly when the reverse proxy is in place.

### 2. Configure Production Secrets

Create a private `.env` file on the deployment host:

```dotenv
ADMIN_PASSWORD=<strong-unique-admin-password>
ADMIN_SESSION_SECRET=<long-random-session-signing-secret>
APP_ORIGIN=https://example.com
```

- Use the exact public HTTPS origin for `APP_ORIGIN`, without a trailing slash.
- Keep `ADMIN_SESSION_SECRET` separate from the admin password.
- Never commit `.env` or place secrets directly in `docker-compose.yml`.
- Rotating `ADMIN_SESSION_SECRET` invalidates all existing admin sessions.

The backend currently derives a session secret from the password when
`ADMIN_SESSION_SECRET` is absent. Make a separate secret mandatory in production
before launch.

### 3. Provide Persistent CMS Storage

Published posts, projects, drafts, and uploaded images are stored under
`content/blog/`. Homepage settings are stored in `content/site.json`. SQLite is
not currently the source of truth for this content.

The Compose bind mount preserves these files across container recreation, but it
does not protect against host disk loss. On the production host:

- Mount `content/` from a permanent host path or managed persistent disk.
- Ensure the backend container has write permission to that location.
- Do not use `git clean -fdx` in the deployment directory.
- Do not rely on a container image layer to retain published content.

### 4. Add and Test Backups

Back up at least:

```text
content/blog/
content/site.json
```

Run backups automatically, retain multiple versions, and keep a copy outside the
deployment host. Perform a restore test before launch. Generated files under
`frontend/public/blog/` and `frontend/public/projects/` can be regenerated and
are not the primary backup source.

### 5. Create a Reproducible Release

- Review and commit all intended source changes.
- Build from a clean Git checkout of that commit.
- Record the deployed commit hash.
- Do not build production from an uncommitted working tree.

### 6. Run the Full Container Verification

With Docker Desktop's Linux engine running:

```powershell
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
Invoke-RestMethod http://localhost:3000/health
```

Then verify manually:

- `/`, `/blog/`, and `/projects/` render on desktop and mobile.
- A published blog and project open at their public routes.
- `/admin` rejects a wrong password and accepts the configured password.
- Admin home changes persist after container recreation.
- Creating, previewing, publishing, editing, downloading, and deleting content works.
- Drafts and their assets are not accessible from public routes.
- Content remains after `docker compose down` followed by `docker compose up -d`.
- A backup can be restored into a clean deployment.

## Production Hardening

These items should be addressed before treating the service as an unattended
production system:

- Run the frontend and backend containers as non-root users.
- Pin and periodically update the Bun and Alpine image versions.
- Configure reverse-proxy access logs, application log retention, and rotation.
- Add container memory and CPU limits appropriate for the host.
- Add automated tests for authentication, origin checks, drafts, publishing,
  assets, duplicate slugs, and persistence.
- Add deployment health monitoring and alerts.
- Document password and session-secret rotation procedures.

## Architecture Cleanup Decision

The SQLite service is initialized and required by Compose, but posts, drafts,
projects, assets, and homepage settings currently use filesystem storage. Before
production, choose one simple direction:

1. Remove the unused SQLite service and its backend dependency, keeping the CMS
   filesystem-based with reliable persistent storage and backups.
2. Move appropriate CMS metadata into SQLite and keep uploaded assets on
   persistent filesystem storage.

For the current implementation, option 1 follows KISS and removes an unnecessary
availability dependency.

## Deployment Decision

The project is ready for public deployment only when all items in **Required
Before Public Deployment** pass on the actual hosting environment. Until then,
treat it as staging-ready rather than production-ready.
