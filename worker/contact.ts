import { WorkerMailer } from "worker-mailer";

export interface Env {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
  ALLOWED_ORIGIN?: string;
}

type ContactFields = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

const MAX_BODY_BYTES = 32 * 1024;

function clean(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseContact(body: Record<string, unknown>): { fields?: ContactFields; error?: string } {
  const fields: ContactFields = {
    name: clean(body.name, 100),
    email: clean(body.email, 320),
    subject: clean(body.subject, 200),
    message: clean(body.message, 5000),
  };
  if (!fields.name) return { error: "Name is required" };
  if (!validEmail(fields.email)) return { error: "A valid email is required" };
  if (!fields.subject) return { error: "Subject is required" };
  if (fields.message.length < 10) return { error: "Message must be at least 10 characters" };
  return { fields };
}

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get("origin")?.replace(/\/$/, "");
  if (!origin) return null;
  const expected = (env.ALLOWED_ORIGIN ?? "https://nayaneupho.github.io").replace(/\/$/, "");
  if (origin === expected || origin === "http://localhost:3000" || origin === "http://localhost:3005") {
    return origin;
  }
  return null;
}

function json(data: unknown, status: number, corsOrigin: string | null): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
  if (corsOrigin) {
    headers["access-control-allow-origin"] = corsOrigin;
    headers["vary"] = "Origin";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const corsOrigin = allowedOrigin(req, env);

    if (req.method === "OPTIONS") {
      if (!corsOrigin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": corsOrigin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
          vary: "Origin",
        },
      });
    }

    if (url.pathname === "/health") {
      return json({ ok: true }, 200, corsOrigin);
    }

    if (url.pathname !== "/api/contact") {
      return json({ error: "Not found" }, 404, corsOrigin);
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsOrigin);
    }

    if (!corsOrigin) {
      return json({ error: "Invalid request origin" }, 403, null);
    }

    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return json({ error: "Message is too large" }, 413, corsOrigin);
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid request body" }, 400, corsOrigin);
    }

    // Bots tend to fill every input; pretend the message went through.
    if (clean(body.company, 100)) {
      return json({ ok: true }, 200, corsOrigin);
    }

    const { fields, error } = parseContact(body);
    if (!fields) {
      return json({ error }, 400, corsOrigin);
    }

    if (!env.SMTP_USER || !env.SMTP_PASS) {
      return json({ error: "Contact email is not configured yet" }, 503, corsOrigin);
    }

    const contactTo = env.CONTACT_TO ?? "nayanmodicd@gmail.com";
    const contactFrom = env.CONTACT_FROM || env.SMTP_USER || contactTo;

    try {
      await WorkerMailer.send(
        {
          host: env.SMTP_HOST ?? "smtp.gmail.com",
          port: Number(env.SMTP_PORT ?? 465),
          secure: (env.SMTP_SECURE ?? "true") !== "false",
          authType: "plain",
          credentials: {
            username: env.SMTP_USER,
            password: env.SMTP_PASS,
          },
        },
        {
          from: { name: "Portfolio contact", email: contactFrom },
          to: contactTo,
          reply: fields.email,
          subject: `[Portfolio] ${fields.subject}`,
          text: `Name: ${fields.name}\nEmail: ${fields.email}\n\n${fields.message}`,
          html: `<p><strong>Name:</strong> ${escapeHtml(fields.name)}<br><strong>Email:</strong> ${escapeHtml(fields.email)}</p><p>${escapeHtml(fields.message).replaceAll("\n", "<br>")}</p>`,
        }
      );
    } catch (sendError) {
      console.error("Could not send contact email", sendError);
      return json({ error: "Could not send the message right now" }, 502, corsOrigin);
    }

    return json({ ok: true }, 200, corsOrigin);
  },
};
