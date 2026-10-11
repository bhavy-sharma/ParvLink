// The emails this app sends. Plain wording, a text part and a simple HTML part.
// The link is the only variable; nothing a user typed is put into an email.

const APP_NAME = "ParvLink";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function layout({ heading, intro, button, link, outro }) {
  const safeLink = escapeHtml(link);
  return {
    text: `${heading}\n\n${intro}\n\n${link}\n\n${outro}\n\n— ${APP_NAME}`,
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1b1a2e;line-height:1.5">
<h1 style="font-size:20px">${escapeHtml(heading)}</h1>
<p>${escapeHtml(intro)}</p>
<p><a href="${safeLink}" style="display:inline-block;background:#3b2fb8;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${escapeHtml(button)}</a></p>
<p style="font-size:13px;color:#5b5a70">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${safeLink}</span></p>
<p style="font-size:13px;color:#5b5a70">${escapeHtml(outro)}</p>
<p style="font-size:13px;color:#5b5a70">— ${APP_NAME}</p>
</body></html>`,
  };
}

export function verificationEmail(link, { hours }) {
  return {
    subject: `Confirm your email for ${APP_NAME}`,
    ...layout({
      heading: "Confirm your email address",
      intro: `Someone — hopefully you — created a ${APP_NAME} account with this address. Confirm it to finish setting up the account.`,
      button: "Confirm my email",
      link,
      outro: `The link works once and expires in ${hours} hours. If you did not create an account, ignore this email: nothing happens unless the link is opened.`,
    }),
  };
}

export function passwordResetEmail(link, { minutes }) {
  return {
    subject: `Choose a new password for ${APP_NAME}`,
    ...layout({
      heading: "Choose a new password",
      intro: `We received a request to reset the password of the ${APP_NAME} account with this address.`,
      button: "Choose a new password",
      link,
      outro: `The link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email: your password stays as it is.`,
    }),
  };
}
