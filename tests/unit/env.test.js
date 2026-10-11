// Configuration readers and the building blocks of sign-in: database address,
// SMTP settings, the site URL used in emailed links, tokens, password hashing,
// cookie options and the emails themselves.
import { afterEach, describe, expect, test, vi } from "vitest";
import { registrationCookieOptions, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/cookies";
import { hashPassword, passwordFitsBcrypt, verifyPassword } from "@/lib/auth/passwords";
import { hashToken, looksLikeToken, newToken, sameHash } from "@/lib/auth/tokens";
import { readMongoUri } from "@/lib/db/connection";
import { MailNotConfiguredError, readMailConfig } from "@/lib/mail/mailer";
import { passwordResetEmail, verificationEmail } from "@/lib/mail/messages";
import { getSiteUrl, isHttpsDeployment } from "@/lib/site-url";

afterEach(() => vi.unstubAllEnvs());

describe("MONGODB_URI", () => {
  test("is required and must be a MongoDB address", () => {
    expect(() => readMongoUri({})).toThrow(/not configured/);
    expect(() => readMongoUri({ MONGODB_URI: "   " })).toThrow(/not configured/);
    expect(() => readMongoUri({ MONGODB_URI: "mysql://localhost/db" })).toThrow(/mongodb:\/\//);
    expect(() => readMongoUri({ MONGODB_URI: "localhost:27017" })).toThrow(/mongodb:\/\//);
    expect(readMongoUri({ MONGODB_URI: " mongodb://127.0.0.1:27017/cpf " })).toBe("mongodb://127.0.0.1:27017/cpf");
    expect(readMongoUri({ MONGODB_URI: "mongodb+srv://user:pw@cluster.example.net/cpf" })).toMatch(/^mongodb\+srv:/);
  });

  test("an error about it never repeats the value (it contains a password)", () => {
    try {
      readMongoUri({ MONGODB_URI: "https://user:hunter2@example.com" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error.message).not.toContain("hunter2");
    }
  });
});

describe("SMTP settings", () => {
  const base = { SMTP_HOST: "smtp.example.com", SMTP_USER: "apikey", SMTP_PASS: "secret", EMAIL_FROM: "Campus <no-reply@example.com>" };

  test("port 587 with STARTTLS required is the default", () => {
    const config = readMailConfig(base);
    expect(config.from).toBe("Campus <no-reply@example.com>");
    expect(config.transport).toMatchObject({ host: "smtp.example.com", port: 587, secure: false, requireTLS: true, auth: { user: "apikey", pass: "secret" } });
  });

  test("port 465 uses implicit TLS; SMTP_SECURE overrides the guess", () => {
    expect(readMailConfig({ ...base, SMTP_PORT: "465" }).transport).toMatchObject({ port: 465, secure: true, requireTLS: false });
    expect(readMailConfig({ ...base, SMTP_PORT: "2465", SMTP_SECURE: "true" }).transport.secure).toBe(true);
    expect(readMailConfig({ ...base, SMTP_PORT: "465", SMTP_SECURE: "false" }).transport).toMatchObject({ secure: false, requireTLS: true });
  });

  test("only a mail catcher on this machine may be unencrypted and without a login", () => {
    const local = readMailConfig({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025", EMAIL_FROM: "dev@localhost" });
    expect(local.transport).toMatchObject({ secure: false, requireTLS: false, auth: undefined });
    expect(readMailConfig({ SMTP_HOST: "mail.example.com", SMTP_PORT: "25", EMAIL_FROM: "a@example.com" }).transport.requireTLS).toBe(true);
  });

  test("missing or half-given settings are named, without their values", () => {
    expect(() => readMailConfig({})).toThrow(MailNotConfiguredError);
    expect(() => readMailConfig({})).toThrow(/SMTP_HOST, EMAIL_FROM/);
    expect(() => readMailConfig({ ...base, EMAIL_FROM: " " })).toThrow(/EMAIL_FROM/);
    expect(() => readMailConfig({ ...base, SMTP_PASS: "" })).toThrow(/SMTP_PASS/);
    expect(() => readMailConfig({ ...base, SMTP_USER: "" })).toThrow(/SMTP_USER/);
    expect(() => readMailConfig({ ...base, SMTP_PORT: "smtp" })).toThrow(/SMTP_PORT/);
    expect(() => readMailConfig({ ...base, SMTP_PORT: "70000" })).toThrow(/SMTP_PORT/);
    try {
      readMailConfig({ ...base, SMTP_USER: "" });
    } catch (error) {
      expect(error.code).toBe("mail_not_configured");
      expect(error.message).not.toContain("secret");
    }
  });
});

describe("the site URL used in emailed links", () => {
  test("comes from APP_URL, reduced to its origin", () => {
    expect(getSiteUrl({ APP_URL: "https://partners.example.edu/some/path?x=1" })).toBe("https://partners.example.edu");
    expect(getSiteUrl({ APP_URL: "http://localhost:3000/" })).toBe("http://localhost:3000");
    expect(getSiteUrl({})).toBe("http://localhost:3000");
    expect(getSiteUrl({ VERCEL_URL: "cpf-abc.vercel.app" })).toBe("https://cpf-abc.vercel.app");
    expect(getSiteUrl({ APP_URL: "https://real.example", VERCEL_URL: "cpf-abc.vercel.app" })).toBe("https://real.example");
  });

  test("refuses anything that is not a web address", () => {
    for (const bad of ["javascript:alert(1)", "not a url", "ftp://example.com", "//example.com"]) expect(() => getSiteUrl({ APP_URL: bad })).toThrow(/APP_URL/);
  });

  test("cookies are Secure on HTTPS deployments", () => {
    expect(isHttpsDeployment({ APP_URL: "https://x.example" })).toBe(true);
    expect(isHttpsDeployment({ VERCEL: "1" })).toBe(true);
    expect(isHttpsDeployment({ APP_URL: "http://localhost:3000" })).toBe(false);

    vi.stubEnv("APP_URL", "https://partners.example.edu");
    expect(sessionCookieOptions()).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 30 * 24 * 60 * 60 });
    expect(sessionCookieOptions(900).maxAge).toBe(900);
    expect(registrationCookieOptions()).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/auth/confirm" });
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("VERCEL", "");
    expect(sessionCookieOptions().secure).toBe(false);
    expect(SESSION_COOKIE).toBe("cpf_session");
  });
});

describe("tokens", () => {
  test("are long, random and URL-safe; only their hash is meant to be stored", () => {
    const tokens = new Set(Array.from({ length: 500 }, newToken));
    expect(tokens.size).toBe(500);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const token = newToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(newToken())).not.toBe(hashToken(token));
  });

  test("anything that does not look like a token is rejected before the database is asked", () => {
    expect(looksLikeToken(newToken())).toBe(true);
    for (const bad of ["", "short", "a".repeat(44), `${"a".repeat(42)}$`, null, undefined, 42, { $ne: null }, ["a".repeat(43)]]) expect(looksLikeToken(bad)).toBe(false);
  });

  test("hash comparison", () => {
    const hash = hashToken("x");
    expect(sameHash(hash, hashToken("x"))).toBe(true);
    expect(sameHash(hash, hashToken("y"))).toBe(false);
    expect(sameHash(hash, hash.slice(1))).toBe(false);
    expect(sameHash(hash, null)).toBe(false);
  });
});

describe("password hashing", () => {
  test("bcrypt with a per-password salt; the password is not recoverable from the hash", async () => {
    const one = await hashPassword("CorrectHorse9");
    const two = await hashPassword("CorrectHorse9");
    expect(one).toMatch(/^\$2[aby]\$12\$/);
    expect(one).not.toBe(two);
    expect(one).not.toContain("CorrectHorse9");
    expect(await verifyPassword("CorrectHorse9", one)).toBe(true);
    expect(await verifyPassword("CorrectHorse9", two)).toBe(true);
    expect(await verifyPassword("correcthorse9", one)).toBe(false);
    expect(await verifyPassword("", one)).toBe(false);
  });

  test("no hash, odd input and over-long passwords never match", async () => {
    for (const hash of [null, undefined, ""]) expect(await verifyPassword("anything", hash)).toBe(false);
    expect(await verifyPassword("no-such-account-placeholder", null)).toBe(false); // the timing dummy is not a way in
    const hash = await hashPassword("CorrectHorse9");
    for (const bad of [null, undefined, 42, { $ne: "" }, ["CorrectHorse9"]]) expect(await verifyPassword(bad, hash)).toBe(false);

    // bcrypt reads 72 bytes: two passwords that differ only after that must not be treated as the same.
    expect(passwordFitsBcrypt("a".repeat(72))).toBe(true);
    expect(passwordFitsBcrypt("a".repeat(73))).toBe(false);
    expect(passwordFitsBcrypt("é".repeat(37))).toBe(false); // 74 bytes
    await expect(hashPassword("a".repeat(73))).rejects.toThrow();
    await expect(hashPassword("")).rejects.toThrow();
    const long = await hashPassword("a".repeat(72));
    expect(await verifyPassword(`${"a".repeat(72)}b`, long)).toBe(false);
  });
});

describe("the emails", () => {
  const link = "https://partners.example.edu/auth/confirm?token=abc&type=email";

  test("carry the link in both parts, say how long it works, and nothing else variable", () => {
    const mail = verificationEmail(link, { hours: 24 });
    expect(mail.subject).toMatch(/Confirm your email/);
    expect(mail.text).toContain(link);
    expect(mail.html).toContain("token=abc&amp;type=email");
    expect(mail.text).toMatch(/expires in 24 hours/);
    expect(mail.text).toMatch(/works once/);

    const reset = passwordResetEmail(link.replace("email", "recovery"), { minutes: 60 });
    expect(reset.subject).toMatch(/new password/);
    expect(reset.text).toMatch(/expires in 60 minutes/);
    expect(reset.text).toMatch(/password stays as it is/);
  });

  test("a hostile link cannot inject markup", () => {
    const mail = verificationEmail('https://x.example/"><script>alert(1)</script>', { hours: 24 });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
