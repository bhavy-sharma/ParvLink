"use server";

import { connectDb } from "@/lib/db/connection";
import { User, AuthToken } from "@/lib/db/models";
import { sendMail } from "@/lib/mail/mailer"; // Tumhare path ke hisaab se
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/cookies";
import { clientIp } from "@/lib/auth/request";
import { logServerError } from "@/lib/auth/errors";
import { homeForRole, safeNextPath } from "@/lib/auth/routes";
import { destroySession, login as authenticate } from "@/lib/services/auth";
import { formError } from "@/lib/form-state";
import { fieldErrors, loginSchema } from "@/lib/validation/schemas";

// ============================================================================
// 1. REGISTER ACTION
// ============================================================================
export async function registerAction(prevState, formData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();
  const confirmPassword = formData.get("confirmPassword")?.toString();
  const agree = formData.get("agree");

  if (!email || !password) {
    return { status: "error", message: "Email aur password zaroori hain!", fieldErrors: {}, values: { email: email || "" } };
  }
  if (password.length < 6) {
    return { status: "error", message: "Password kam se kam 6 characters ka hona chahiye", fieldErrors: { password: "Too short" }, values: { email: email || "" } };
  }
  if (password !== confirmPassword) {
    return { status: "error", message: "Passwords match nahi kar rahe!", fieldErrors: { confirmPassword: "Passwords don't match" }, values: { email: email || "" } };
  }
  if (!agree) {
    return { status: "error", message: "Terms of Use accept karna zaroori hai!", fieldErrors: { agree: "You must agree to the terms" }, values: { email: email || "" } };
  }

  try {
    await connectDb();

    const existing = await User.findOne({ email });
    if (existing) {
      return { status: "error", message: "Ye email pehle se registered hai!", fieldErrors: { email: "Already exists" }, values: { email: email || "" } };
    }

    const password_hash = await bcrypt.hash(password, 12);

    const user = await User.create({
      email,
      password_hash,
      email_confirmed_at: null,
      role: "student",
    });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const token_hash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await AuthToken.create({
      user_id: user._id,
      kind: "verify_email",
      token_hash,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/verify-email?token=${rawToken}`;
    
    try {
      await sendMail({
        to: email,
        subject: "Verify your email — Campus Partner",
        html: `<div style="font-family: Arial; padding: 20px;"><h2>Welcome! 👋</h2><p>Apna email verify karne ke liye neeche click karo:</p><a href="${verifyUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Verify Email</a><p style="color: #999; margin-top: 16px;">Link 24 ghante me expire ho jayega.</p></div>`,
      });
    } catch (emailErr) {
      console.error("❌ EMAIL ERROR:", emailErr.message);
    }

    return { status: "success", message: "Registration successful! Email check karo verification ke liye 📧", fieldErrors: {}, values: { email: "" } };
  } catch (err) {
    console.error("❌ [auth.register] FULL ERROR:", err);
    return { status: "error", message: `Registration failed: ${err.message || "Unknown error"}`, fieldErrors: {}, values: { email: email || "" } };
  }
}

// ============================================================================
export async function loginAction(prevState, formData) {
  const emailValue = formData.get("email");
  const values = { email: typeof emailValue === "string" ? emailValue : "" };
  const parsed = loginSchema.safeParse({
    email: emailValue,
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return formError("Check the highlighted fields.", {
      fieldErrors: fieldErrors(parsed.error),
      values,
    });
  }

  try {
    const result = await authenticate({ ...parsed.data, ip: await clientIp() });
    if (result.status === "invalid") {
      return formError("That email and password do not match an account. Check both and try again.", {
        fieldErrors: { email: "Invalid credentials" },
        values,
      });
    }
    if (result.status === "unverified") {
      return formError("Confirm your email address before logging in.", {
        fieldErrors: { email: "Confirm your email first." },
        values,
      });
    }
    if (result.status === "limited") {
      return formError("Too many attempts. Wait a few minutes, then try again.", { values });
    }

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
    return {
      status: "success",
      message: "Signed in.",
      fieldErrors: {},
      values: {},
      redirectTo: safeNextPath(formData.get("next"), homeForRole(result.role)),
    };
  } catch (error) {
    logServerError("auth.login", error);
    return formError("Login failed. Please try again.", { values });
  }
}

// ============================================================================
// 3. VERIFY EMAIL ACTION (Ye missing tha, ab add kar diya!)
// ============================================================================
export async function verifyEmailAction(token) {
  if (!token || typeof token !== "string") {
    return { status: "error", message: "Invalid verification link." };
  }

  try {
    await connectDb();

    const token_hash = crypto.createHash("sha256").update(token).digest("hex");

    const authToken = await AuthToken.findOne({
      kind: "verify_email",
      token_hash,
      expires_at: { $gt: new Date() },
      used_at: null,
    });

    if (!authToken) {
      return { status: "error", message: "Ye link invalid hai ya expire ho chuka hai. Dobara register karo ya resend karo." };
    }

    await User.updateOne({ _id: authToken.user_id }, { email_confirmed_at: new Date() });
    await AuthToken.updateOne({ _id: authToken._id }, { used_at: new Date() });

    return { status: "success", message: "Email successfully verified! Ab tum login kar sakte ho." };
  } catch (err) {
    console.error("❌ [auth.verifyEmail] FULL ERROR:", err);
    return { status: "error", message: "Verification failed. Please try again." };
  }
}

// ============================================================================
// 4. RESET PASSWORD ACTION
// ============================================================================
export async function resetPasswordAction(prevState, formData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();

  if (!email) {
    return { status: "error", message: "Email zaroori hai!", fieldErrors: { email: "Email required" }, values: { email: "" } };
  }

  try {
    await connectDb();
    const user = await User.findOne({ email });
    
    if (!user) {
      return { status: "success", message: "Agar ye email registered hai, toh aapko password reset link mil jayega.", fieldErrors: {}, values: { email: "" } };
    }

    await AuthToken.deleteMany({ user_id: user._id, kind: "reset_password" });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const token_hash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await AuthToken.create({
      user_id: user._id,
      kind: "reset_password",
      token_hash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password/confirm?token=${rawToken}`;
    
    try {
      await sendMail({
        to: email,
        subject: "Password Reset — Campus Partner",
        html: `<div style="font-family: Arial; padding: 20px;"><h2>Password Reset 🔄</h2><p>Aapne password reset ki request ki thi. Naya password set karne ke liye neeche click karo:</p><a href="${resetUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Reset Password</a><p style="color: #999; margin-top: 16px;">Ye link 1 ghante me expire ho jayega.</p></div>`,
      });
    } catch (emailErr) {
      console.error("❌ RESET EMAIL ERROR:", emailErr.message);
    }

    return { status: "success", message: "Agar ye email registered hai, toh aapko password reset link mil jayega.", fieldErrors: {}, values: { email: "" } };
  } catch (err) {
    console.error("❌ [auth.resetPassword] FULL ERROR:", err);
    return { status: "error", message: "Kuch galat ho gaya. Dobara try karo.", fieldErrors: {}, values: { email: email || "" } };
  }
}

// ============================================================================
// 5. RESEND VERIFICATION ACTION
// ============================================================================
export async function resendVerificationAction(prevState, formData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();

  if (!email) {
    return { status: "error", message: "Email zaroori hai!", fieldErrors: { email: "Email required" }, values: { email: "" } };
  }

  try {
    await connectDb();
    const user = await User.findOne({ email });
    
    if (!user || user.email_confirmed_at) {
      return { status: "success", message: "Agar ye email registered hai, toh aapko verification link mil jayega.", fieldErrors: {}, values: { email: "" } };
    }

    await AuthToken.deleteMany({ user_id: user._id, kind: "verify_email" });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const token_hash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await AuthToken.create({
      user_id: user._id,
      kind: "verify_email",
      token_hash,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/verify-email?token=${rawToken}`;
    
    try {
      await sendMail({
        to: email,
        subject: "Verify your email — Campus Partner",
        html: `<div style="font-family: Arial; padding: 20px;"><h2>Email Verification 📧</h2><p>Apna email verify karne ke liye neeche click karo:</p><a href="${verifyUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Verify Email</a><p style="color: #999; margin-top: 16px;">Ye link 24 ghante me expire ho jayega.</p></div>`,
      });
    } catch (emailErr) {
      console.error("❌ RESEND EMAIL ERROR:", emailErr.message);
    }

    return { status: "success", message: "Agar ye email registered hai, toh aapko verification link mil jayega.", fieldErrors: {}, values: { email: "" } };
  } catch (err) {
    console.error("❌ [auth.resendVerification] FULL ERROR:", err);
    return { status: "error", message: "Kuch galat ho gaya. Dobara try karo.", fieldErrors: {}, values: { email: email || "" } };
  }
}

// ============================================================================
// 6. LOGOUT ACTION
// ============================================================================
export async function logoutAction(prevState, formData) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
    cookieStore.delete(SESSION_COOKIE);
    if (sessionToken) await destroySession(sessionToken);

    return { status: "success", message: "Signed out.", fieldErrors: {}, values: {} };
  } catch (error) {
    logServerError("auth.logout", error);
    return { status: "error", message: "Logout failed. Please try again.", fieldErrors: {}, values: {} };
  }
}

// ============================================================================
// 7. REQUEST PASSWORD RESET ACTION
// ============================================================================
export async function requestPasswordResetAction(prevState, formData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();

  if (!email) {
    return { status: "error", message: "Email zaroori hai!", fieldErrors: { email: "Email required" }, values: { email: "" } };
  }

  try {
    await connectDb();
    const user = await User.findOne({ email });
    
    if (!user) {
      return { status: "success", message: "Agar ye email registered hai, toh aapko password reset link mil jayega.", fieldErrors: {}, values: { email: "" } };
    }

    await AuthToken.deleteMany({ user_id: user._id, kind: "reset_password" });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const token_hash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await AuthToken.create({
      user_id: user._id,
      kind: "reset_password",
      token_hash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password/confirm?token=${rawToken}`;
    
    try {
      await sendMail({
        to: email,
        subject: "Password Reset — Campus Partner",
        html: `<div style="font-family: Arial; padding: 20px;"><h2>Password Reset 🔄</h2><p>Aapne password reset ki request ki thi. Naya password set karne ke liye neeche click karo:</p><a href="${resetUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Reset Password</a><p style="color: #999; margin-top: 16px;">Ye link 1 ghante me expire ho jayega.</p></div>`,
      });
    } catch (emailErr) {
      console.error("❌ RESET EMAIL ERROR:", emailErr.message);
    }

    return { status: "success", message: "Agar ye email registered hai, toh aapko password reset link mil jayega.", fieldErrors: {}, values: { email: "" } };
  } catch (err) {
    console.error("❌ [auth.requestPasswordReset] FULL ERROR:", err);
    return { status: "error", message: "Kuch galat ho gaya. Dobara try karo.", fieldErrors: {}, values: { email: email || "" } };
  }
}