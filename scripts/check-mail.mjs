#!/usr/bin/env node
// Checks the SMTP settings: connects and logs in, and optionally sends one
// test message.
//
//   npm run mail:check                       # connection and login only
//   npm run mail:check -- you@example.org    # also send a test message
//
// Prints what failed in plain words. Never prints the password.

import { loadEnv } from "./lib/env.mjs";

loadEnv();
const { readMailConfig, sendMail, verifyMailTransport } = await import("../src/lib/mail/mailer.js");
const to = process.argv[2];

try {
  const config = readMailConfig();
  console.log(`SMTP server   ${config.transport.host}:${config.transport.port} (${config.transport.secure ? "implicit TLS" : config.transport.requireTLS ? "STARTTLS required" : "no TLS — local only"})`);
  console.log(`Login         ${config.transport.auth ? config.transport.auth.user : "none"}`);
  console.log(`From          ${config.from}`);
  await verifyMailTransport();
  console.log("Connection and login: OK");
  if (to) {
    await sendMail({ to, subject: "ParvLink — test message", text: "If you can read this, outgoing email works.", html: "<p>If you can read this, outgoing email works.</p>" });
    console.log(`Test message handed to the SMTP server for ${to}. Check the inbox (and spam).`);
  }
} catch (error) {
  console.error(`Email check failed: ${error?.code ?? ""} ${error?.message ?? error}`.trim());
  process.exitCode = 1;
}
