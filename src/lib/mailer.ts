import nodemailer from "nodemailer";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toSimpleHtml(text: string) {
  return `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">${escapeHtml(
    text,
  ).replaceAll("\n", "<br/>")}</div>`;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export function getGmailTransporter() {
  const user = requiredEnv("GMAIL_USER");
  const pass = requiredEnv("GMAIL_APP_PASSWORD");

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

export async function sendGmailMessage(params: {
  to: string;
  subject: string;
  text: string;
}) {
  const user = requiredEnv("GMAIL_USER");
  const fromName = process.env.GMAIL_FROM_NAME?.trim();
  const replyTo = process.env.GMAIL_REPLY_TO?.trim();
  const transporter = getGmailTransporter();

  return transporter.sendMail({
    from: fromName ? `${fromName} <${user}>` : user,
    to: params.to,
    replyTo: replyTo || undefined,
    subject: params.subject,
    text: params.text,
    html: toSimpleHtml(params.text),
  });
}
