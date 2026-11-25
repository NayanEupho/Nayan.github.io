# Deployment Readiness

## Current Status

The public site is static HTML. The backend only handles contact-form submissions
and delivers them by email. This is ready for local development and staging; do
the items below before exposing it publicly.

## Required Before Public Deployment

### 1. Use HTTPS

Put the site behind a reverse proxy with TLS (Caddy, Nginx, Cloudflare, or a
managed host). Public traffic must use HTTPS.

Only the public proxy should accept internet traffic. Keep the backend internal
and do not expose port `3001`.

### 2. Configure Production Secrets

Create a private `.env` on the host:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=nayanmodicd@gmail.com
SMTP_PASS=<google-app-password>
CONTACT_TO=nayanmodicd@gmail.com
CONTACT_FROM=nayanmodicd@gmail.com
APP_ORIGIN=https://example.com
```

`APP_ORIGIN` must exactly match the public origin, without a trailing slash. Never
commit `.env`.

### 3. Protect the Contact Endpoint

The backend rate-limits to five messages per ten minutes per IP and checks the
request origin. If the site is behind a proxy, make sure `x-forwarded-for` is set
correctly; otherwise every request appears to come from one address.

For heavier abuse, add rate limiting at the reverse proxy and consider a
CAPTCHA. The downside is a worse experience for real users.

### 4. Run the Full Container Verification

With Docker running:

```powershell
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
Invoke-RestMethod http://localhost:3000/health
```

Then check manually:

- `/`, `/blog/`, `/projects/`, and `/contact.html` render on desktop and mobile.
- A blog post opens from the listing.
- A project card opens the correct GitHub repository.
- The contact form validates, rate limits, and sends email after SMTP is configured.

## Production Hardening

- Run the frontend and backend containers as non-root users.
- Pin and periodically update the Bun and Alpine image versions.
- Add container memory and CPU limits.
- Configure reverse-proxy access logs and log rotation.
- Monitor the health endpoint and email delivery failures.
