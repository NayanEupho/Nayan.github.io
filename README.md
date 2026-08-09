# ni5arga clone

Pixel-focused static clone of `https://ni5arga.com/` with the home page, blog index, and the `hacking-ccd` article route.

## Local

Run the backend API:

```powershell
cd backend
$env:ADMIN_PASSWORD = "change-me"
bun server.ts
```

Run the frontend:

```powershell
cd frontend
$env:API_URL = "http://localhost:3001"
bun server.ts
```

Open `http://localhost:3000`.

## Docker

```powershell
docker compose up --build
```

Set `ADMIN_PASSWORD` before running Compose for a non-default admin password:

```powershell
$env:ADMIN_PASSWORD = "change-me"
docker compose up --build
```

Services:

- `frontend`: Bun static server on `localhost:3000`
- `backend`: Bun API server on internal port `3001`
- `database`: Alpine SQLite holder sharing the `sqlite-data` volume
- Admin UI: `http://localhost:3000/admin`
