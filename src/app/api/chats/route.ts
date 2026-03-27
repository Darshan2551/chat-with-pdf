import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureOwnedDocuments } from "@/lib/chat";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import type { DashboardChat } from "@/lib/types";

const createChatSchema = z.object({
  documentIds: z.array(z.string()).min(1),
});

const toDashboardChat = (chat: {
  id: string;
  title: string;
  updatedAt: Date;
  documents: { documentId: string }[];
}): DashboardChat => ({
  id: chat.id,
  title: chat.title,
  updatedAt: chat.updatedAt.toISOString(),
  documentIds: chat.documents.map((document) => document.documentId),
  lastMessagePreview: null,
});

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  try {
    const body = createChatSchema.parse(await request.json());
    await ensureOwnedDocuments(userId, body.documentIds);

    const chat = await prisma.chat.create({
      data: {
        userId,
        title: "New chat",
        documents: {
          create: [...new Set(body.documentIds)].map((documentId) => ({
            documentId,
          })),
        },
      },
      include: {
        documents: {
          select: {
            documentId: true,
          },
        },
      },
    });

    return NextResponse.json({
      chat: toDashboardChat(chat),
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to create chat.",
      400,
    );
  }
}
