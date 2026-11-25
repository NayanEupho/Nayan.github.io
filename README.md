# Nayan Modi — personal website

A small personal site with static HTML pages for the homepage, blog, projects, and
contact form. The only backend work is receiving contact-form submissions and
emailing the site owner.

## Structure

```text
frontend/public/       static HTML, CSS, JS, and images
frontend/server.ts     static file server + /api/contact proxy
backend/server.ts      contact API (nodemailer)
```

Blog and project pages are plain HTML. There is no CMS, no markdown renderer, and
no database. Contact messages are delivered by email only.

## Local development

Create a private environment file and set the Gmail app password:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set `SMTP_USER` and `SMTP_PASS`. Gmail requires an app password.
`CONTACT_TO` defaults to `nayanmodicd@gmail.com`.

Install dependencies, then start the backend:

```powershell
bun install
bun backend/server.ts
```

In a second terminal, start the frontend:

```powershell
$env:API_URL = "http://localhost:3001"
bun frontend/server.ts
```

Open `http://localhost:3000`.

## Docker

```powershell
docker compose up --build
```

Services:

- `frontend`: Bun static server on `localhost:3000`
- `backend`: Bun contact API on internal port `3001`

The contact endpoint returns `503` until `SMTP_USER` and `SMTP_PASS` are set.

## Pages

- Home: `/`
- Blog: `/blog/`
- Projects: `/projects/`
- Contact: `/contact.html`
- Health: `/health`
