import { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        deliveries: {
          orderBy: { createdAt: "desc" },
          include: {
            recipient: {
              select: { email: true, name: true },
            },
          },
        },
      },
    });

    return res.status(200).json({ campaigns });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
}
