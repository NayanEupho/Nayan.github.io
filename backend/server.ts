import { Database } from "bun:sqlite";

const dbPath = process.env.SQLITE_PATH ?? `${import.meta.dir}/site.sqlite`;
const db = new Database(dbPath);

db.run(`
  CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  )
`);

Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/visits") {
      db.run(`
        INSERT INTO counters (name, count)
        VALUES ('visits', 1)
        ON CONFLICT(name) DO UPDATE SET count = count + 1
      `);

      const row = db.query("SELECT count FROM counters WHERE name = 'visits'").get() as { count: number };
      return Response.json({ visits: row.count });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
});
