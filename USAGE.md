# Website Usage Guide

This project can run directly with Bun or as a Docker Compose stack. Choose one
method at a time so both methods do not compete for ports `3000` and `3001`.

## URLs

Once started, the application is available at:

- Website: `http://localhost:3000`
- Blog: `http://localhost:3000/blog/`
- Admin: `http://localhost:3000/admin`
- Health check: `http://localhost:3000/health`

## Environment Setup

The backend will not start without an admin password of at least 8 characters.
The private `.env` file is ignored by Git.

If `.env` does not exist, create it from the example while in the repository root:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

Edit `.env` and set these values:

```dotenv
ADMIN_PASSWORD=replace-with-a-password-of-at-least-8-characters
ADMIN_SESSION_SECRET=replace-with-a-long-random-secret
APP_ORIGIN=http://localhost:3000
```

- `ADMIN_PASSWORD` is the password used at `/admin`.
- `ADMIN_SESSION_SECRET` signs login sessions. Keep it different from the password.
- `APP_ORIGIN` must exactly match the website origin. Use the public HTTPS origin
  in production, without a trailing slash.

Restart the backend after changing `.env`. Changing `ADMIN_SESSION_SECRET` signs
out all existing admin sessions.

## Option 1: Run With Bun

### Requirements

- Bun
- Two terminal windows

The project currently has no third-party npm packages and no `package.json`.
There is therefore no `bun install` or `npm install` step. Bun itself provides
the HTTP runtime and all APIs used by the project.

### Install Bun

Windows PowerShell:

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

macOS or Linux:

```bash
curl -fsSL https://bun.com/install | bash
```

Linux also needs `unzip` for the Bun installer. For Debian or Ubuntu:

```bash
sudo apt update
sudo apt install unzip
```

Open a new terminal and verify the installation:

```powershell
bun --version
```

### Start the Backend

Open a terminal in the repository root:

```powershell
bun backend/server.ts
```

The backend listens on `http://localhost:3001`. Run the command from the
repository root so Bun loads the root `.env` file.

### Start the Frontend

Open a second terminal in the repository root.

Windows PowerShell:

```powershell
$env:API_URL = "http://localhost:3001"
bun frontend/server.ts
```

macOS or Linux:

```bash
API_URL=http://localhost:3001 bun frontend/server.ts
```

The frontend listens on `http://localhost:3000` and proxies dynamic requests to
the backend.

### Development Watch Mode

For automatic server restarts while editing TypeScript, use these commands in
separate terminals:

```powershell
bun --watch backend/server.ts
```

```powershell
$env:API_URL = "http://localhost:3001"
bun --watch frontend/server.ts
```

Changes to files in `frontend/public` are served directly and normally need only
a browser refresh.

### Stop Bun Servers

Press `Ctrl+C` in both terminal windows.

## Option 2: Run With Docker

### Requirements

- Docker Desktop with the Linux container engine running
- Docker Compose, included with Docker Desktop

Install Docker Desktop from the official Docker documentation and start it before
running Compose. Verify both commands work:

```powershell
docker version
docker compose version
```

Bun does not need to be installed on the host for this method. The frontend and
backend images include Bun, and the database image installs SQLite.

### Build and Start

From the repository root:

```powershell
docker compose up --build -d
```

Compose reads the root `.env` file automatically. It starts:

- `frontend` on host port `3000`
- `backend` on internal port `3001`
- `database` with a persistent SQLite volume

The current publishing implementation stores site and post content under
`content`; the SQLite service is initialized for the container architecture but
does not currently hold blog or admin records.

Check service status and health:

```powershell
docker compose ps
```

Follow logs:

```powershell
docker compose logs -f frontend backend database
```

### Rebuild After Code Changes

```powershell
docker compose up --build -d
```

For a clean container recreation without deleting content or the SQLite volume:

```powershell
docker compose up --build -d --force-recreate
```

### Stop Docker Services

Stop and remove the containers and network:

```powershell
docker compose down
```

The named SQLite volume remains available for the next start.

To also delete the named volume, use the following only when its stored data is
no longer needed:

```powershell
docker compose down --volumes
```

This does not delete blog files under `content`, which are bind-mounted from the
repository.

## Verify the Installation

PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected response:

```json
{"ok":true}
```

macOS or Linux:

```bash
curl http://localhost:3000/health
```

Then open `http://localhost:3000/admin` and sign in with the `ADMIN_PASSWORD`
from `.env`.

## Troubleshooting

### Port 3000 or 3001 Is Already in Use

Stop the other Bun process or Docker stack before starting another method:

```powershell
docker compose down
```

On Windows, inspect listeners with:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,3001
```

### Backend Rejects the Password Configuration

Ensure `.env` is in the repository root and `ADMIN_PASSWORD` contains at least
8 characters. Start Bun commands from the repository root, then restart the
backend.

### Docker Cannot Connect to the Engine

Start Docker Desktop and wait until the Linux engine reports that it is running.
Then retry:

```powershell
docker compose up --build -d
```

### Admin Writes Return `Invalid request origin`

Set `APP_ORIGIN` to the exact origin shown in the browser address bar. For local
use, it should normally be:

```dotenv
APP_ORIGIN=http://localhost:3000
```

Restart the backend after changing it.

## Official Installation References

- Bun installation: https://bun.com/docs/installation
- Docker Desktop for Windows: https://docs.docker.com/desktop/setup/install/windows-install/
- Docker Compose installation: https://docs.docker.com/compose/install/
