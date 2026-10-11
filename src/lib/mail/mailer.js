// Outgoing email through SMTP with Nodemailer.
//
// Server only by nature (it reads SMTP_PASS); nothing here is imported by a
// Client Component. Also used by scripts, so: relative imports, no Next.js.
//
// Configuration (all from environment variables):
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, EMAIL_FROM
//   SMTP_SECURE   optional "true"/"false"; default: true for port 465 (implicit
//                 TLS), false otherwise (STARTTLS is then required, see below)

import nodemailer from "nodemailer";

export class MailNotConfiguredError extends Error {
  constructor(missing) {
    super(`Email is not configured: ${missing.join(", ")} missing.`);
    this.name = "MailNotConfiguredError";
    this.code = "mail_not_configured";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Validates the SMTP settings. Returns Nodemailer options plus the From address; never logs them. */
export function readMailConfig(env = process.env) {
  const missing = ["SMTP_HOST", "EMAIL_FROM"].filter((name) => !String(env[name] ?? "").trim());
  if (missing.length > 0) throw new MailNotConfiguredError(missing);
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) {
    throw new MailNotConfiguredError([env.SMTP_USER ? "SMTP_PASS" : "SMTP_USER"]);
  }
  const host = env.SMTP_HOST.trim();
  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT is not a valid port number.");
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465;
  return {
    from: env.EMAIL_FROM.trim(),
    transport: {
      host,
      port,
      secure,
      // Port 587/25: refuse to send credentials or mail over an unencrypted
      // connection. Only a mail catcher on this machine may be plain.
      requireTLS: !secure && !LOCAL_HOSTS.has(host),
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    },
  };
}

// One transporter per process; re-created if the settings change (tests, hot reload).
const state = (globalThis.__cpfMailer ??= { key: null, transporter: null, from: null });

function transporter() {
  const config = readMailConfig();
  const key = JSON.stringify([config.transport.host, config.transport.port, config.transport.secure, config.transport.auth?.user ?? null, config.from]);
  if (state.key !== key) {
    state.transporter = nodemailer.createTransport(config.transport);
    state.key = key;
    state.from = config.from;
  }
  return state;
}

/**
 * Sends one message. Throws on failure; the caller decides what the person is
 * told. Log lines carry an error code only — never the recipient, the link or
 * any credential.
 */
export async function sendMail({ to, subject, text, html }) {
  const { transporter: smtp, from } = transporter();
  try {
    await smtp.sendMail({ from, to, subject, text, html });
  } catch (error) {
    const failure = new Error("mail_send_failed");
    failure.code = error?.code ?? error?.responseCode ?? "mail_send_failed";
    throw failure;
  }
}

/** For the health check and the set-up script: can the SMTP server be reached and logged in to? */
export async function verifyMailTransport() {
  await transporter().transporter.verify();
}
