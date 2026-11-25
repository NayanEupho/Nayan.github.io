# Website Usage Guide

The site runs either directly with Bun or as a Docker Compose stack. Choose one
method at a time so both do not compete for ports `3000` and `3001`.

## URLs

- Homepage: `http://localhost:3000`
- Blog: `http://localhost:3000/blog/`
- Projects: `http://localhost:3000/projects/`
- Contact: `http://localhost:3000/contact.html`
- Health check: `http://localhost:3000/health`

## Environment

Create `.env` from the example:

```powershell
Copy-Item .env.example .env
```

Set the Gmail SMTP values:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=nayanmodicd@gmail.com
SMTP_PASS=replace-with-a-google-app-password
CONTACT_TO=nayanmodicd@gmail.com
APP_ORIGIN=http://localhost:3000
```

`SMTP_PASS` must be a Google App Password, not the normal Gmail password. Until
it is set, the contact form returns `503` and the message is not sent.

## Option 1: Run with Bun

Install dependencies once:

```powershell
bun install
```

Start the backend in one terminal:

```powershell
bun backend/server.ts
```

Start the frontend in another terminal:

```powershell
$env:API_URL = "http://localhost:3001"
bun frontend/server.ts
```

Open `http://localhost:3000`.

For automatic restarts while editing TypeScript, use `bun --watch` on either
server. HTML and CSS changes under `frontend/public` only need a browser refresh.

## Option 2: Run with Docker

```powershell
docker compose up --build -d
```

Compose reads `.env` from the repository root and starts:

- `frontend` on host port `3000`
- `backend` on internal port `3001`

Check status and logs:

```powershell
docker compose ps
docker compose logs -f frontend backend
```

Stop the stack:

```powershell
docker compose down
```

Containers keep no persistent data; contact messages are delivered by email.

## Editing Content

Blog posts and project cards are plain HTML:

- `frontend/public/blog/index.html` — blog listing
- `frontend/public/blog/*.html` — individual posts
- `frontend/public/projects/index.html` — project cards
- `frontend/public/projects/*.html` — individual project pages

Project cards open a local project page, not GitHub directly. Each project page
has a short description and a "View on GitHub" button.

Add a new page by creating an HTML file and linking it from the listing. No build
step is required.

## Contact Form

The form posts JSON to `/api/contact`. The backend validates the fields, rate
limits by IP, and sends the email. The browser never talks to SMTP directly.

## Troubleshooting

### Contact form says the email is not configured

Set `SMTP_USER` and `SMTP_PASS` in `.env` and restart the backend or containers.

### Gmail rejects the login

Use a Google App Password. Two-factor authentication must be enabled on the
Google account before an app password can be created.

### Port 3000 or 3001 is already in use

Stop the other Bun process or Docker stack:

```powershell
docker compose down
```

Inspect listeners:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,3001
```

## Official References

- Bun installation: https://bun.com/docs/installation
- Docker Desktop for Windows: https://docs.docker.com/desktop/setup/install/windows-install/
- Docker Compose installation: https://docs.docker.com/compose/install/
- Google App Passwords: https://support.google.com/accounts/answer/185833
