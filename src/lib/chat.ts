import "server-only";

import { prisma } from "@/lib/prisma";

export const ensureOwnedDocuments = async (userId: string, documentIds: string[]) => {
  const uniqueIds = [...new Set(documentIds)];

  if (uniqueIds.length === 0) {
    throw new Error("Select at least one document.");
  }

  const documents = await prisma.document.findMany({
    where: {
      userId,
      id: {
        in: uniqueIds,
      },
    },
    select: {
      id: true,
      originalName: true,
    },
  });

  if (documents.length !== uniqueIds.length) {
    throw new Error("One or more selected documents are invalid.");
  }

  return documents;
};

export const deriveChatTitle = (question: string) => {
  const title = question.trim().split(/\s+/).slice(0, 7).join(" ");
  return title || "New chat";
};

export const syncChatDocuments = async (chatId: string, documentIds: string[]) => {
  const uniqueIds = [...new Set(documentIds)];

  await prisma.chatDocument.deleteMany({
    where: {
      chatId,
    },
  });

  if (uniqueIds.length > 0) {
    await prisma.chatDocument.createMany({
      data: uniqueIds.map((documentId) => ({
        chatId,
        documentId,
      })),
    });
  }
};
