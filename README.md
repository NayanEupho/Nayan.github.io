# ni5arga clone

Pixel-focused static clone of `https://ni5arga.com/` with the home page, blog index, and the `hacking-ccd` article route.

See [USAGE.md](USAGE.md) for complete Bun and Docker installation, startup,
shutdown, environment, and troubleshooting instructions.

## Local

Create your private environment file and set a password of at least 8 characters:

```powershell
Copy-Item .env.example .env
```

Edit `.env` to set `ADMIN_PASSWORD`. Bun loads this file automatically. The file
is ignored by Git, so changing the value and restarting the backend rotates the
admin password without changing source code.

Run the backend API:

```powershell
bun backend/server.ts
```

Run the frontend:

```powershell
$env:API_URL = "http://localhost:3001"
bun frontend/server.ts
```

Open `http://localhost:3000`.

## Docker

```powershell
docker compose up --build
```

Compose reads `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and `APP_ORIGIN` from
the root `.env` file. There is no default admin password; startup fails when the
password is missing or shorter than 8 characters.

Services:

- `frontend`: Bun static server on `localhost:3000`
- `backend`: Bun API server on internal port `3001`
- `database`: Alpine SQLite holder sharing the `sqlite-data` volume
- Admin UI: `http://localhost:3000/admin`
