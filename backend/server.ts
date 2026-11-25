import nodemailer from "nodemailer";

// The backend has one job: accept contact-form submissions and email the site
// owner. Everything public is static HTML.
const port = Number(process.env.PORT ?? 3001);
const contactTo = process.env.CONTACT_TO ?? "nayanmodicd@gmail.com";
const contactFrom = process.env.CONTACT_FROM || process.env.SMTP_USER || contactTo;
const appOrigin = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");

const smtpHost = process.env.SMTP_HOST ?? "smtp.gmail.com";
const smtpPort = Number(process.env.SMTP_PORT ?? 465);
const smtpSecure = (process.env.SMTP_SECURE ?? "true") !== "false";
const smtpUser = process.env.SMTP_USER ?? "";
const smtpPass = process.env.SMTP_PASS ?? "";
const mailer = smtpUser && smtpPass
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
    })
  : null;

if (!mailer) {
  console.warn("SMTP is not configured. Contact submissions will return 503 until SMTP_USER and SMTP_PASS are set.");
}

const attempts = new Map<string, { count: number; resetAt: number }>();
const maxBodyBytes = 32 * 1024;

function securityHeaders() {
  return {
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...securityHeaders(), ...(init.headers ?? {}) },
  });
}

function requestIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "direct";
}

function originIsValid(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.headers.get("origin");
  return !origin || origin.replace(/\/$/, "") === appOrigin;
}

function isRateLimited(ip: string) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 5;
}

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type ContactFields = { name: string; email: string; subject: string; message: string };

function parseContact(body: Record<string, unknown>): { fields?: ContactFields; error?: string } {
  const fields = {
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

async function sendContactEmail(fields: ContactFields) {
  await mailer!.sendMail({
    from: `"Portfolio contact" <${contactFrom}>`,
    to: contactTo,
    replyTo: fields.email,
    subject: `[Portfolio] ${fields.subject}`,
    text: `Name: ${fields.name}\nEmail: ${fields.email}\n\n${fields.message}`,
    html: `<p><strong>Name:</strong> ${escapeHtml(fields.name)}<br><strong>Email:</strong> ${escapeHtml(fields.email)}</p><p>${escapeHtml(fields.message).replaceAll("\n", "<br>")}</p>`,
  });
}

async function handleContact(req: Request) {
  if (!originIsValid(req)) return json({ error: "Invalid request origin" }, { status: 403 });
  if (isRateLimited(requestIp(req))) return json({ error: "Too many messages. Please try again later." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > maxBodyBytes) return json({ error: "Message is too large" }, { status: 413 });

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  // Bots tend to fill every input. Pretend the message went through so they do
  // not learn which field is the trap.
  if (clean(body.company, 100)) return json({ ok: true });

  const { fields, error } = parseContact(body);
  if (!fields) return json({ error }, { status: 400 });
  if (!mailer) return json({ error: "Contact email is not configured yet" }, { status: 503 });

  try {
    await sendContactEmail(fields);
  } catch (sendError) {
    console.error("Could not send contact email", sendError);
    return json({ error: "Could not send the message right now" }, { status: 502 });
  }

  return json({ ok: true });
}

Bun.serve({
  port,
  maxRequestBodySize: maxBodyBytes,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname === "/api/contact") {
      if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
      return handleContact(req);
    }
    return json({ error: "Not found" }, { status: 404 });
  },
});
