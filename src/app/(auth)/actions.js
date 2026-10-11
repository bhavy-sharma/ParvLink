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

// ============================================================================
// LOGIN ACTION
// ============================================================================
export async function loginAction(prevState, formData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();

  if (!email || !password) {
    return { 
      status: "error", 
      message: "Email aur password dono zaroori hain!", 
      fieldErrors: { 
        email: !email ? "Email required" : undefined,
        password: !password ? "Password required" : undefined
      },
      values: { email: email || "" }
    };
  }

  try {
    await connectDb();

    // 1. Find user
    const user = await User.findOne({ email });
    if (!user || !user.password_hash) {
      return { 
        status: "error", 
        message: "Invalid email ya password!", 
        fieldErrors: { email: "Invalid credentials" },
        values: { email: email || "" }
      };
    }

    // 2. Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return { 
        status: "error", 
        message: "Invalid email ya password!", 
        fieldErrors: { password: "Invalid credentials" },
        values: { email: email || "" }
      };
    }

    // 3. Check if email is verified (Optional - agar chahiye toh uncomment karo)
    // if (!user.email_confirmed_at) {
    //   return { 
    //     status: "error", 
    //     message: "Pehle apna email verify karo!", 
    //     fieldErrors: {},
    //     values: { email: email || "" }
    //   };
    // }

    // 4. Create Session
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const token_hash = crypto.createHash("sha256").update(sessionToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await Session.create({
      user_id: user._id,
      token_hash,
      expires_at: expiresAt,
      last_seen_at: new Date(),
    });

    // 5. Set HttpOnly Cookie
    const cookieStore = await cookies();
    cookieStore.set("session_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      path: "/",
    });

    console.log("✅ Login successful for:", user.email);

    // 6. Return success (redirect client-side se hoga)
    return {
      status: "success",
      message: "Login successful!",
      fieldErrors: {},
      values: { email: "" }
    };

  } catch (err) {
    console.error("❌ [auth.login] FULL ERROR:", err);
    return {
      status: "error",
      message: "Login failed. Dobara try karo.",
      fieldErrors: {},
      values: { email: email || "" }
    };
  }
}

// ============================================================================
// RESET PASSWORD ACTION (Forgot Password - Email bhejta hai)
// ============================================================================
export async function resetPasswordAction(prevState, formData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();

  if (!email) {
    return { 
      status: "error", 
      message: "Email zaroori hai!", 
      fieldErrors: { email: "Email required" },
      values: { email: "" }
    };
  }

  try {
    await connectDb();

    // User dhundho
    const user = await User.findOne({ email });
    
    // Security: Agar user nahi bhi hai, tab bhi success message dikhao (email enumeration attack se bachne ke liye)
    if (!user) {
      return {
        status: "success",
        message: "Agar ye email registered hai, toh aapko password reset link mil jayega.",
        fieldErrors: {},
        values: { email: "" }
      };
    }

    // Purane reset tokens delete karo (agar koi ho)
    await AuthToken.deleteMany({ 
      user_id: user._id, 
      kind: "reset_password" 
    });

    // Naya reset token generate karo
    const rawToken = crypto.randomBytes(32).toString("hex");
    const token_hash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await AuthToken.create({
      user_id: user._id,
      kind: "reset_password",
      token_hash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });

    // Reset link bhejo
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password/confirm?token=${rawToken}`;
    
    try {
      await sendMail({
        to: email,
        subject: "Password Reset — Campus Partner",
        html: `
          <div style="font-family: Arial; padding: 20px;">
            <h2>Password Reset 🔄</h2>
            <p>Aapne password reset ki request ki thi. Naya password set karne ke liye neeche click karo:</p>
            <a href="${resetUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">
              Reset Password
            </a>
            <p style="color: #999; margin-top: 16px;">Ye link 1 ghante me expire ho jayega.</p>
            <p style="color: #666;">Agar aapne ye request nahi ki thi, toh is email ko ignore kar do.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error("❌ RESET EMAIL ERROR:", emailErr.message);
    }

    return {
      status: "success",
      message: "Agar ye email registered hai, toh aapko password reset link mil jayega.",
      fieldErrors: {},
      values: { email: "" }
    };

  } catch (err) {
    console.error("❌ [auth.resetPassword] FULL ERROR:", err);
    return {
      status: "error",
      message: "Kuch galat ho gaya. Dobara try karo.",
      fieldErrors: {},
      values: { email: email || "" }
    };
  }
}


// ============================================================================
// RESEND VERIFICATION EMAIL ACTION
// ============================================================================
export async function resendVerificationAction(prevState, formData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();

  if (!email) {
    return {
      status: "error",
      message: "Email zaroori hai!",
      fieldErrors: { email: "Email required" },
      values: { email: "" }
    };
  }

  try {
    await connectDb();

    // 1. User dhundho
    const user = await User.findOne({ email });
    
    // Security: User nahi hai ya already verified hai, tab bhi same message dikhao
    if (!user) {
      return {
        status: "success",
        message: "Agar ye email registered hai, toh aapko verification link mil jayega.",
        fieldErrors: {},
        values: { email: "" }
      };
    }

    if (user.email_confirmed_at) {
      return {
        status: "success",
        message: "Ye email pehle se verified hai. Aap login kar sakte ho.",
        fieldErrors: {},
        values: { email: "" }
      };
    }

    // 2. Purane verify_email tokens delete karo
    await AuthToken.deleteMany({
      user_id: user._id,
      kind: "verify_email"
    });

    // 3. Naya verification token generate karo
    const rawToken = crypto.randomBytes(32).toString("hex");
    const token_hash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await AuthToken.create({
      user_id: user._id,
      kind: "verify_email",
      token_hash,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    // 4. Verification email bhejo
    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/verify-email?token=${rawToken}`;
    
    try {
      await sendMail({
        to: email,
        subject: "Verify your email — Campus Partner",
        html: `
          <div style="font-family: Arial; padding: 20px;">
            <h2>Email Verification 📧</h2>
            <p>Apna email verify karne ke liye neeche click karo:</p>
            <a href="${verifyUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">
              Verify Email
            </a>
            <p style="color: #999; margin-top: 16px;">Ye link 24 ghante me expire ho jayega.</p>
            <p style="color: #666;">Agar aapne ye request nahi ki thi, toh is email ko ignore kar do.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error("❌ RESEND EMAIL ERROR:", emailErr.message);
    }

    return {
      status: "success",
      message: "Agar ye email registered hai, toh aapko verification link mil jayega.",
      fieldErrors: {},
      values: { email: "" }
    };

  } catch (err) {
    console.error("❌ [auth.resendVerification] FULL ERROR:", err);
    return {
      status: "error",
      message: "Kuch galat ho gaya. Dobara try karo.",
      fieldErrors: {},
      values: { email: email || "" }
    };
  }
}