import { DeliveryStatus } from "@prisma/client";
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { escapeHtml, sendGmailMessage } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { renderRecipientTemplate } from "@/lib/template";

const sendSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10000),
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

function buildEmailText(mainBody: string, recipient: { email: string; name: string | null }) {
  const intro = renderRecipientTemplate(EMAIL_INTRO_TEMPLATE, recipient);
  return `${intro}\n\n${mainBody}\n\n${EMAIL_SIGNATURE}`;
}

function buildEmailHtml(mainBody: string, recipient: { email: string; name: string | null }) {
  const intro = renderRecipientTemplate(EMAIL_INTRO_TEMPLATE, recipient);
  const fullTextWithoutSignature = `${intro}\n\n${mainBody}`;
  const escapedBody = escapeHtml(fullTextWithoutSignature).replaceAll("\n", "<br/>");

  return `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">${escapedBody}<br/><br/>Best,<br/>Rishikesh Yadav<br/>Founder, Comply AI<br/>rishi@complyai.dev | <a href="${LINKEDIN_URL}" target="_blank" rel="noopener noreferrer">LinkedIn</a> | +1 (862)-703 8504</div>`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid send request.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const uniqueRecipientIds = Array.from(new Set(parsed.data.recipientIds));

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

    const campaign = await prisma.campaign.create({
      data: {
        subject: parsed.data.subject,
        body: parsed.data.body,
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
      const subject = renderRecipientTemplate(parsed.data.subject, recipient);
      const mainBody = renderRecipientTemplate(parsed.data.body, recipient).trim();
      const body = buildEmailText(mainBody, recipient);

      try {
        const info = await sendGmailMessage({
          to: recipient.email,
          subject,
          text: body,
          html: buildEmailHtml(mainBody, recipient),
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
        const message =
          error instanceof Error ? error.message : "Unknown error while sending";

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
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
}
