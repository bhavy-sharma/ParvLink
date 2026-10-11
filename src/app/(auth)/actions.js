"use server";

import { connectDb } from "@/lib/db/connection";
import { User, AuthToken } from "@/lib/db/models";
import { sendMail } from "@/lib/mail/mailer";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export async function registerAction(prevState, formData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();
  const confirmPassword = formData.get("confirmPassword")?.toString();
  const agree = formData.get("agree");

  // Validation
  if (!email || !password) {
    return { 
      status: "error", 
      message: "Email aur password zaroori hain!", 
      fieldErrors: {},
      values: { email: email || "" } // ← ADD THIS
    };
  }

  if (password.length < 6) {
    return { 
      status: "error", 
      message: "Password kam se kam 6 characters ka hona chahiye", 
      fieldErrors: { password: "Too short" },
      values: { email: email || "" } // ← ADD THIS
    };
  }

  if (password !== confirmPassword) {
    return {
      status: "error",
      message: "Passwords match nahi kar rahe!",
      fieldErrors: { confirmPassword: "Passwords don't match" },
      values: { email: email || "" } // ← ADD THIS
    };
  }

  if (!agree) {
    return {
      status: "error",
      message: "Terms of Use accept karna zaroori hai!",
      fieldErrors: { agree: "You must agree to the terms" },
      values: { email: email || "" } // ← ADD THIS
    };
  }

  try {
    await connectDb();

    // Check existing user
    const existing = await User.findOne({ email });
    if (existing) {
      return { 
        status: "error", 
        message: "Ye email pehle se registered hai!", 
        fieldErrors: { email: "Already exists" },
        values: { email: email || "" } // ← ADD THIS
      };
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Create User
    const user = await User.create({
      email,
      password_hash,
      email_confirmed_at: null,
      role: "student",
    });

    // Create Verification Token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const token_hash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await AuthToken.create({
      user_id: user._id,
      kind: "verify_email",
      token_hash,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    // Send Verification Email
    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/verify-email?token=${rawToken}`;
    
    try {
      await sendMail({
        to: email,
        subject: "Verify your email — Campus Partner",
        html: `
          <div style="font-family: Arial; padding: 20px;">
            <h2>Welcome! 👋</h2>
            <p>Apna email verify karne ke liye neeche click karo:</p>
            <a href="${verifyUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">
              Verify Email
            </a>
            <p style="color: #999; margin-top: 16px;">Link 24 ghante me expire ho jayega.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error("❌ EMAIL ERROR:", emailErr.message);
    }

    return {
      status: "success",
      message: "Registration successful! Email check karo verification ke liye 📧",
      fieldErrors: {},
      values: { email: "" } // ← ADD THIS: Success ke baad form clear ho jaye
    };

  } catch (err) {
    console.error("❌ [auth.register] FULL ERROR:", err);
    return {
      status: "error",
      message: `Registration failed: ${err.message || "Unknown error"}`,
      fieldErrors: {},
      values: { email: email || "" } // ← ADD THIS
    };
  }
}

export async function loginAction(prevState, formData) {
  // ... (login action waise hi rahega, agar chahiye toh bata dena)
}