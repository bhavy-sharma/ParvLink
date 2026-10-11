// scripts/test-mail.mjs
import "dotenv/config";
import { verifyMailTransport, sendMail } from "../../src/lib/mail/mailer";

async function test() {
  try {
    console.log("🔍 Verifying mail transport...");
    await verifyMailTransport();
    console.log("✅ Transport verified successfully!");

    console.log("📧 Sending test email...");
    const result = await sendMail({
      to: process.env.SMTP_USER,
      subject: "Test Email from Campus Partner",
      text: "Agar ye dikh raha hai toh email kaam kar raha hai bhai!",
      html: "<h2>✅ Email kaam kar raha hai bhai!</h2>",
    });
    console.log("🎉 Email sent! Message ID:", result.messageId);
  } catch (err) {
    console.error("❌ Test failed:", err.message);
  }
}
test();