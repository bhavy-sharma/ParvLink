// A local SMTP server for tests. The application sends real emails to it with
// Nodemailer over SMTP, exactly as it would to a provider; the tests then read
// what arrived — which is the only way to get a confirmation or reset link,
// because the database stores those tokens as hashes.
//
//   import { startMailSink } from "./mail-sink.mjs";
//   const sink = await startMailSink({ smtpPort: 2525, httpPort: 2526 });
//   sink.messages  → [{ to, subject, text, html, link, at }]
//
// As a process (for the browser tests):  node tests/support/mail-sink.mjs 2525 2526
//   GET  http://127.0.0.1:2526/messages?to=a@b.test   → JSON list, oldest first
//   POST http://127.0.0.1:2526/fail  {"fail":true}    → refuse mail (simulates an outage)

import http from "node:http";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";

const LINK = /https?:\/\/[^\s"<>]+\/auth\/confirm\?[^\s"<>]+/;

export async function startMailSink({ smtpPort = 0, httpPort = null } = {}) {
  const messages = [];
  const state = { fail: false };

  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onData(stream, _session, done) {
      if (state.fail) {
        stream.resume();
        stream.on("end", () => done(Object.assign(new Error("mailbox unavailable"), { responseCode: 451 })));
        return;
      }
      simpleParser(stream)
        .then((mail) => {
          const text = mail.text ?? "";
          messages.push({
            to: (mail.to?.value ?? []).map((entry) => entry.address.toLowerCase()),
            from: mail.from?.text ?? "",
            subject: mail.subject ?? "",
            text,
            html: typeof mail.html === "string" ? mail.html : "",
            link: LINK.exec(text)?.[0] ?? null,
            at: Date.now(),
          });
          done();
        })
        .catch(done);
    },
  });
  await new Promise((resolve, reject) => smtp.listen(smtpPort, "127.0.0.1", (error) => (error ? reject(error) : resolve())));

  let api = null;
  if (httpPort !== null) {
    api = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && url.pathname === "/messages") {
        const to = url.searchParams.get("to")?.toLowerCase();
        return send(200, to ? messages.filter((message) => message.to.includes(to)) : messages);
      }
      if (req.method === "POST" && url.pathname === "/fail") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          state.fail = Boolean(JSON.parse(body || "{}").fail);
          send(200, { fail: state.fail });
        });
        return undefined;
      }
      if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true });
      return send(404, { error: "not found" });
    });
    await new Promise((resolve) => api.listen(httpPort, "127.0.0.1", resolve));
  }

  return {
    messages,
    state,
    port: smtp.server.address().port,
    for: (address) => messages.filter((message) => message.to.includes(String(address).toLowerCase())),
    close: () => new Promise((resolve) => smtp.close(() => (api ? api.close(() => resolve()) : resolve()))),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sink = await startMailSink({ smtpPort: Number(process.argv[2] ?? 2525), httpPort: Number(process.argv[3] ?? 2526) });
  console.log(`mail sink: smtp 127.0.0.1:${sink.port}, http 127.0.0.1:${process.argv[3] ?? 2526}`);
}
