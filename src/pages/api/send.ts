import { DeliveryStatus } from "@prisma/client";
import { convert } from "html-to-text";
import { promises as fs } from "node:fs";
import { formidable, type Fields, type File as FormidableFile, type Files } from "formidable";
import type Mail from "nodemailer/lib/mailer";
import type { NextApiRequest, NextApiResponse } from "next";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { escapeHtml, sendGmailMessage } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { renderRecipientTemplate } from "@/lib/template";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024;

const sendSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  bodyText: z.string().trim().min(1).max(20000),
  bodyHtml: z.string().max(120000).optional(),
  recipientIds: z.array(z.string().min(1)).min(1),
});

const EMAIL_SIGNATURE = [
  "Best,",
  "Rishikesh Yadav",
  "Founder, Comply AI",
  "rishi@complyai.dev | LinkedIn | +1 (862)-703 8504",
].join("\n");

const LINKEDIN_URL = "https://www.linkedin.com/in/rishikesh-y-75846420b/";

const EMAIL_INTRO_TEMPLATE = ["Hi {{name}},", "", "I hope this email finds you well."].join(
  "\n",
);

const HTML_SANITIZE_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "div",
    "span",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    span: ["style"],
    p: ["style"],
    div: ["style"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedStyles: {
    "*": {
      "text-decoration": [/^underline$/],
      "font-style": [/^italic$/],
      "font-weight": [/^(bold|[5-9]00)$/],
    },
  },
};

type PreparedSendPayload = {
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  recipientIds: string[];
  attachments: Mail.Attachment[];
};

function getContentTypeHeader(req: NextApiRequest) {
  const header = req.headers["content-type"];
  return Array.isArray(header) ? header[0] || "" : header || "";
}

function getFieldValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function flattenFiles(files: Files): FormidableFile[] {
  const flattened: FormidableFile[] = [];

  for (const value of Object.values(files)) {
    if (!value) {
      continue;
    }

    if (Array.isArray(value)) {
      flattened.push(...value);
    } else {
      flattened.push(value);
    }
  }

  return flattened;
}

async function parseJsonBody(req: NextApiRequest) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function parseMultipartBody(req: NextApiRequest) {
  const form = formidable({
    multiples: true,
    allowEmptyFiles: false,
    maxFileSize: MAX_ATTACHMENT_FILE_BYTES,
    maxTotalFileSize: MAX_ATTACHMENT_TOTAL_BYTES,
  });

  return new Promise<{ fields: Fields; files: Files }>((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ fields, files });
    });
  });
}

async function buildAttachmentsFromFiles(files: FormidableFile[]) {
  if (files.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`Too many attachments. Max ${MAX_ATTACHMENT_COUNT} files.`);
  }

  const attachments: Mail.Attachment[] = [];
  let totalBytes = 0;

  for (const file of files) {
    const content = await fs.readFile(file.filepath);
    totalBytes += content.byteLength;

    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("Attachments are too large. Keep total under 20MB.");
    }

    attachments.push({
      filename: file.originalFilename || "attachment",
      content,
      contentType: file.mimetype || undefined,
    });
  }

  return attachments;
}

async function deleteTempFiles(files: FormidableFile[]) {
  await Promise.all(
    files.map(async (file) => {
      try {
        await fs.unlink(file.filepath);
      } catch {
        // ignore cleanup failures for temp files
      }
    }),
  );
}

async function parseSendRequest(req: NextApiRequest): Promise<PreparedSendPayload> {
  const contentType = getContentTypeHeader(req);

  if (contentType.includes("multipart/form-data")) {
    const { fields, files } = await parseMultipartBody(req);
    const uploadedFiles = flattenFiles(files);

    try {
      const rawRecipientIds = getFieldValue(fields.recipientIds);
      const parsedRecipientIds = rawRecipientIds ? JSON.parse(rawRecipientIds) : [];

      const parsed = sendSchema.safeParse({
        subject: getFieldValue(fields.subject),
        bodyText: getFieldValue(fields.bodyText),
        bodyHtml: getFieldValue(fields.bodyHtml),
        recipientIds: parsedRecipientIds,
      });

      if (!parsed.success) {
        throw new Error("Invalid send request.");
      }

      const attachments = await buildAttachmentsFromFiles(uploadedFiles);

      return {
        ...parsed.data,
        attachments,
      };
    } finally {
      await deleteTempFiles(uploadedFiles);
    }
  }

  const rawBody = await parseJsonBody(req);

  const parsed = sendSchema.safeParse({
    subject: rawBody.subject,
    bodyText: rawBody.bodyText ?? rawBody.body,
    bodyHtml: rawBody.bodyHtml,
    recipientIds: rawBody.recipientIds,
  });

  if (!parsed.success) {
    throw new Error("Invalid send request.");
  }

  return {
    ...parsed.data,
    attachments: [],
  };
}

function sanitizeMainBodyHtml(rawHtml: string | undefined, fallbackText: string) {
  if (!rawHtml?.trim()) {
    return escapeHtml(fallbackText).replaceAll("\n", "<br/>");
  }

  const sanitized = sanitizeHtml(rawHtml, HTML_SANITIZE_CONFIG).trim();
  if (!sanitized) {
    return escapeHtml(fallbackText).replaceAll("\n", "<br/>");
  }

  return sanitized;
}

function buildEmailText(mainBodyText: string, recipient: { email: string; name: string | null }) {
  const intro = renderRecipientTemplate(EMAIL_INTRO_TEMPLATE, recipient);
  return `${intro}\n\n${mainBodyText}\n\n${EMAIL_SIGNATURE}`;
}

function buildEmailHtml(mainBodyHtml: string, recipient: { email: string; name: string | null }) {
  const greetingLine = renderRecipientTemplate("Hi {{name}},", recipient);

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <p style="margin:0 0 12px 0">${escapeHtml(greetingLine)}</p>
      <p style="margin:0 0 16px 0">I hope this email finds you well.</p>
      <div style="margin:0 0 16px 0">${mainBodyHtml}</div>
      <p style="margin:0">
        Best,<br/>
        Rishikesh Yadav<br/>
        Founder, Comply AI<br/>
        rishi@complyai.dev |
        <a href="${LINKEDIN_URL}" target="_blank" rel="noopener noreferrer">LinkedIn</a>
        | +1 (862)-703 8504
      </p>
    </div>
  `.trim();
}

function htmlToPlainText(html: string) {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      { selector: "img", format: "skip" },
    ],
  }).trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let requestPayload: PreparedSendPayload;
  try {
    requestPayload = await parseSendRequest(req);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid send request.",
    });
  }

  try {
    const uniqueRecipientIds = Array.from(new Set(requestPayload.recipientIds));

    const recipients = await prisma.recipient.findMany({
      where: {
        id: { in: uniqueRecipientIds },
        active: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (recipients.length === 0) {
      return res.status(400).json({ error: "No active recipients selected." });
    }

    const sanitizedMainBodyHtml = sanitizeMainBodyHtml(
      requestPayload.bodyHtml,
      requestPayload.bodyText,
    );
    const normalizedMainBodyText = requestPayload.bodyText.trim() || htmlToPlainText(sanitizedMainBodyHtml);

    const campaign = await prisma.campaign.create({
      data: {
        subject: requestPayload.subject,
        body: normalizedMainBodyText,
      },
    });

    const results: Array<{
      recipientId: string;
      email: string;
      status: "SENT" | "FAILED";
      error?: string;
      sentAt?: string;
    }> = [];

    for (const recipient of recipients) {
      const subject = renderRecipientTemplate(requestPayload.subject, recipient);
      const recipientBodyHtml = renderRecipientTemplate(sanitizedMainBodyHtml, recipient).trim();
      const recipientBodyText = renderRecipientTemplate(
        normalizedMainBodyText || htmlToPlainText(sanitizedMainBodyHtml),
        recipient,
      ).trim();
      const bodyText = buildEmailText(recipientBodyText, recipient);
      const bodyHtml = buildEmailHtml(recipientBodyHtml, recipient);

      try {
        const info = await sendGmailMessage({
          to: recipient.email,
          subject,
          text: bodyText,
          html: bodyHtml,
          attachments: requestPayload.attachments,
        });

        const sentAt = new Date();

        await prisma.delivery.create({
          data: {
            campaignId: campaign.id,
            recipientId: recipient.id,
            status: DeliveryStatus.SENT,
            providerMessageId: info.messageId || null,
            sentAt,
          },
        });

        results.push({
          recipientId: recipient.id,
          email: recipient.email,
          status: "SENT",
          sentAt: sentAt.toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error while sending";
        console.error("[/api/send] recipient send failed", {
          recipientId: recipient.id,
          email: recipient.email,
          message,
        });

        await prisma.delivery.create({
          data: {
            campaignId: campaign.id,
            recipientId: recipient.id,
            status: DeliveryStatus.FAILED,
            error: message.slice(0, 1000),
          },
        });

        results.push({
          recipientId: recipient.id,
          email: recipient.email,
          status: "FAILED",
          error: message,
        });
      }
    }

    const sentCount = results.filter((result) => result.status === "SENT").length;
    const failedCount = results.length - sentCount;

    return res.status(200).json({
      campaignId: campaign.id,
      sentCount,
      failedCount,
      total: results.length,
      results,
    });
  } catch (error) {
    console.error("[/api/send] unexpected error", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
}
