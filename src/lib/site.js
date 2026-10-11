// Who runs this installation and how to reach them — shown in the privacy
// notice, the terms and the footer.
//
// These are deliberately NOT invented. Until the operator sets them, the pages
// show a clearly marked placeholder and a "draft" banner.
//   NEXT_PUBLIC_OPERATOR_NAME    the organisation or person responsible
//   NEXT_PUBLIC_SUPPORT_EMAIL    where students write about support and privacy
//   NEXT_PUBLIC_LEGAL_REVIEWED   "true" once the operator has had the privacy
//                                notice and terms reviewed and completed

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function fromProcess() {
  // Spelled out in full so Next.js can inline them.
  return {
    name: process.env.NEXT_PUBLIC_OPERATOR_NAME,
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    reviewed: process.env.NEXT_PUBLIC_LEGAL_REVIEWED,
  };
}

export function siteDetails(env = fromProcess()) {
  const name = typeof env.name === "string" ? env.name.trim().slice(0, 120) : "";
  const email = typeof env.email === "string" && EMAIL.test(env.email.trim()) ? env.email.trim() : "";
  const reviewed = env.reviewed === "true";
  return {
    operatorName: name || null,
    supportEmail: email || null,
    operatorLabel: name || "[OPERATOR NAME — NOT YET CONFIGURED]",
    supportLabel: email || "[SUPPORT EMAIL — NOT YET CONFIGURED]",
    legalReviewed: reviewed,
    // True only when nothing on the legal pages is still a placeholder.
    complete: Boolean(name && email && reviewed),
  };
}
