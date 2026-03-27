import "server-only";

import { auth } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import type {
  ChatDetail,
  DashboardChat,
  DashboardDocument,
  DashboardMessage,
  SourceSnippet,
} from "@/lib/types";

const normalizeSources = (value: unknown): SourceSnippet[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    chunkId: String((item as Record<string, unknown>).chunkId || ""),
    documentId: String((item as Record<string, unknown>).documentId || ""),
    documentName: String((item as Record<string, unknown>).documentName || ""),
    excerpt: String((item as Record<string, unknown>).excerpt || ""),
    score: Number((item as Record<string, unknown>).score || 0),
  }));
};

const toDashboardMessage = (message: {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  confidence: number | null;
  createdAt: Date;
  sources: unknown;
}): DashboardMessage => ({
  id: message.id,
  role: message.role,
  content: message.content,
  confidence: message.confidence,
  createdAt: message.createdAt.toISOString(),
  sources: normalizeSources(message.sources),
});

export const requireUserId = async () => {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  return userId;
};

export const getDashboardData = async (userId: string) => {
  const [documents, chats] = await Promise.all([
    prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeInBytes: true,
        createdAt: true,
      },
    }),
    prisma.chat.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        documents: {
          select: {
            documentId: true,
          },
        },
        messages: {
          take: 1,
          orderBy: {
            createdAt: "desc",
          },
          select: {
            content: true,
          },
        },
      },
    }),
  ]);

  const normalizedDocuments: DashboardDocument[] = documents.map((document) => ({
    ...document,
    createdAt: document.createdAt.toISOString(),
  }));

  const normalizedChats: DashboardChat[] = chats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt.toISOString(),
    documentIds: chat.documents.map((document) => document.documentId),
    lastMessagePreview: chat.messages[0]?.content || null,
  }));

  return {
    documents: normalizedDocuments,
    chats: normalizedChats,
  };
};

export const getChatDetail = async (userId: string, chatId: string): Promise<ChatDetail | null> => {
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId,
    },
    include: {
      documents: {
        select: {
          documentId: true,
        },
      },
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!chat) {
    return null;
  }

  return {
    id: chat.id,
    title: chat.title,
    documentIds: chat.documents.map((document) => document.documentId),
    messages: chat.messages.map(toDashboardMessage),
  };
};
