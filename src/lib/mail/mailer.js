import "server-only";
import nodemailer from "nodemailer";

/**
 * SMTP configuration:
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 * SMTP_SECURE: optional "true" or "false"
 */

export class MailNotConfiguredError extends Error {
  constructor(missing) {
    super(`Email is not configured: ${missing.join(", ")} missing.`);
    this.name = "MailNotConfiguredError";
    this.code = "mail_not_configured";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Read and validate SMTP configuration.
 */
export function readMailConfig(env = process.env) {
  const missing = ["SMTP_HOST", "EMAIL_FROM"].filter(
    (name) => !String(env[name] ?? "").trim()
  );

  if (missing.length > 0) {
    throw new MailNotConfiguredError(missing);
  }

  const username = String(env.SMTP_USER ?? "").trim();
  const password = String(env.SMTP_PASS ?? "");

  if (Boolean(username) !== Boolean(password)) {
    throw new MailNotConfiguredError([
      username ? "SMTP_PASS" : "SMTP_USER",
    ]);
  }

  const host = String(env.SMTP_HOST).trim();
  const port = Number(env.SMTP_PORT ?? 587);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT is not a valid port number.");
  }

  let secure;

  if (env.SMTP_SECURE === undefined || env.SMTP_SECURE === "") {
    secure = port === 465;
  } else if (env.SMTP_SECURE === "true") {
    secure = true;
  } else if (env.SMTP_SECURE === "false") {
    secure = false;
  } else {
    throw new Error('SMTP_SECURE must be "true" or "false".');
  }

  const auth = username
    ? {
        user: username,
        pass: password,
      }
    : undefined;

  return {
    from: String(env.EMAIL_FROM).trim(),
    transport: {
      host,
      port,
      secure,
      ...(auth ? { auth } : {}),
      requireTLS: !secure && !LOCAL_HOSTS.has(host),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    },
  };
}

/**
 * Reuse the SMTP transporter within the current process.
 * Recreate it when the configuration changes.
 */
const state =
  globalThis.__cpfMailer ??
  (globalThis.__cpfMailer = {
    key: null,
    transporter: null,
    from: null,
  });

function getMailer() {
  const config = readMailConfig();

  const key = JSON.stringify([
    config.transport.host,
    config.transport.port,
    config.transport.secure,
    config.transport.requireTLS,
    config.transport.auth?.user ?? null,
    config.transport.auth?.pass ?? null,
    config.from,
  ]);

  if (state.key !== key || !state.transporter) {
    // Close the old transporter if the configuration changed.
    state.transporter?.close();

    state.transporter = nodemailer.createTransport(config.transport);
    state.key = key;
    state.from = config.from;
  }

  return {
    transporter: state.transporter,
    from: state.from,
  };
}

/**
 * Send one email.
 * Never log credentials, recipients, or verification links.
 */
export async function sendMail({ to, subject, text, html }) {
  const { transporter, from } = getMailer();

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    });

    // Return message information for callers that need it.
    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    };
  } catch (error) {
    console.error("[mail.send]", {
      code: error?.code ?? "mail_send_failed",
      responseCode: error?.responseCode ?? null,
      command: error?.command ?? null,
      message: error?.message ?? "Unknown mail error",
    });

    const failure = new Error("mail_send_failed");
    failure.code = error?.code ?? error?.responseCode ?? "mail_send_failed";
    throw failure;
  }
}

/**
 * Verify that the SMTP server is reachable and authentication works.
 * Call this from a server-side script or protected health-check route.
 */
export async function verifyMailTransport() {
  const { transporter } = getMailer();
  await transporter.verify();
  return { ok: true };
}