import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const recipientSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  firstName: z.string().trim().max(120).optional(),
  name: z.string().trim().max(120).optional(),
}).transform((value) => ({
  email: value.email,
  name: (value.firstName ?? value.name)?.trim() || undefined,
}));

const createRecipientsSchema = z.object({
  recipients: z.array(recipientSchema).min(1),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "GET") {
      const recipients = await prisma.recipient.findMany({
        orderBy: { createdAt: "desc" },
      });

      return res.status(200).json({ recipients });
    }

    if (req.method === "POST") {
      const parsed = createRecipientsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid recipient payload.",
          details: parsed.error.flatten(),
        });
      }

      const recipients = Array.from(
        new Map(
          parsed.data.recipients.map((recipient) => [
            recipient.email,
            { ...recipient, email: recipient.email.toLowerCase() },
          ]),
        ).values(),
      );

      const result = await prisma.recipient.createMany({
        data: recipients,
        skipDuplicates: true,
      });

      return res.status(200).json({
        insertedCount: result.count,
        requestedCount: recipients.length,
        message: `Saved ${result.count} new recipient${result.count === 1 ? "" : "s"}.`,
      });
    }

    if (req.method === "DELETE") {
      const id = z.string().min(1).safeParse(req.query.id);
      if (!id.success) {
        return res.status(400).json({ error: "Missing recipient id." });
      }

      await prisma.recipient.delete({
        where: { id: id.data },
      });

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2025"
    ) {
      return res.status(404).json({ error: "Recipient not found." });
    }

    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
}
