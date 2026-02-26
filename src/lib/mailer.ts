import dns from "node:dns";
import net from "node:net";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function toSimpleHtml(text: string) {
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
  const smtpHost = "smtp.gmail.com";

  return nodemailer.createTransport({
    host: smtpHost,
    port: 587,
    secure: false, // STARTTLS on 587
    requireTLS: true,
    tls: {
      servername: smtpHost,
    },
    auth: { user, pass },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    // Railway can resolve Gmail to IPv6 first, but its runtime may not have IPv6 egress.
    // Force an IPv4 socket and let Nodemailer continue STARTTLS/auth over it.
    getSocket(
      options: { port?: number; connectionTimeout?: number },
      callback: (error: Error | null, socketOptions?: { connection: net.Socket }) => void,
    ) {
      dns.resolve4(smtpHost, (resolveError, addresses) => {
        if (resolveError || !addresses?.length) {
          callback(resolveError || new Error("Could not resolve IPv4 for smtp.gmail.com"));
          return;
        }

        const targetIp = addresses[Math.floor(Math.random() * addresses.length)] || addresses[0];
        const timeoutMs =
          typeof options.connectionTimeout === "number" ? options.connectionTimeout : 20000;
        const socket = net.createConnection({
          host: targetIp,
          port: options.port || 587,
        });

        let settled = false;
        const finish = (error: Error | null, socketOptions?: { connection: net.Socket }) => {
          if (settled) {
            return;
          }

          settled = true;
          callback(error, socketOptions);
        };

        socket.setTimeout(timeoutMs);

        socket.once("connect", () => {
          socket.setTimeout(0);
          finish(null, { connection: socket });
        });

        socket.once("timeout", () => {
          const timeoutError = new Error(
            `SMTP IPv4 connection timeout to ${smtpHost} (${targetIp}:${options.port || 587})`,
          ) as Error & { code?: string };
          timeoutError.code = "ETIMEDOUT";
          socket.destroy(timeoutError);
          finish(timeoutError);
        });

        socket.once("error", (error) => {
          finish(error);
        });
      });
    },
  });
}


export async function sendGmailMessage(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Mail.Attachment[];
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
    html: params.html ?? toSimpleHtml(params.text),
    attachments: params.attachments,
  });
}
