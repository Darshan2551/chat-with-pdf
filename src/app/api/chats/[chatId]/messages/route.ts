import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ChatRole } from "@prisma/client";
import { z } from "zod";

import { streamAnswerFromContext } from "@/lib/ai/gemini";
import {
  deriveChatTitle,
  ensureOwnedDocuments,
  syncChatDocuments,
} from "@/lib/chat";
import { responseCache } from "@/lib/cache";
import {
  CHAT_MEMORY_WINDOW,
  FALLBACK_ANSWER,
} from "@/lib/constants";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getFallbackResult, retrieveRelevantSources } from "@/lib/rag";
import { createScopeKey, normalizeQuestion } from "@/lib/utils";

export const runtime = "nodejs";

const sendMessageSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  documentIds: z.array(z.string()).min(1),
});

const emitEvent = (
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
) => {
  const encoder = new TextEncoder();
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
};

const normalizeSources = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => ({
          chunkId: String((item as Record<string, unknown>).chunkId || ""),
          documentId: String((item as Record<string, unknown>).documentId || ""),
          documentName: String((item as Record<string, unknown>).documentName || ""),
          excerpt: String((item as Record<string, unknown>).excerpt || ""),
          score: Number((item as Record<string, unknown>).score || 0),
        }))
        .filter((item) => item.chunkId && item.documentId)
    : [];

const persistAssistantMessage = async (params: {
  chatId: string;
  response: string;
  confidence: number | null;
  sources: unknown;
  normalizedQuestion: string;
  scopeKey: string;
}) => {
  await prisma.$transaction(async (transaction) => {
    await transaction.chatMessage.create({
      data: {
        chatId: params.chatId,
        role: ChatRole.ASSISTANT,
        content: params.response,
        confidence: params.confidence,
        sources: params.sources as never,
      },
    });

    await transaction.queryCache.upsert({
      where: {
        chatId_scopeKey_normalizedQuestion: {
          chatId: params.chatId,
          scopeKey: params.scopeKey,
          normalizedQuestion: params.normalizedQuestion,
        },
      },
      create: {
        chatId: params.chatId,
        scopeKey: params.scopeKey,
        normalizedQuestion: params.normalizedQuestion,
        response: params.response,
        confidence: params.confidence,
        sources: params.sources as never,
      },
      update: {
        response: params.response,
        confidence: params.confidence,
        sources: params.sources as never,
      },
    });

    await transaction.chat.update({
      where: {
        id: params.chatId,
      },
      data: {
        updatedAt: new Date(),
      },
    });
  });
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { userId } = await auth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  const { chatId } = await params;
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId,
    },
  });

  if (!chat) {
    return jsonError("Chat not found.", 404);
  }

  let body: z.infer<typeof sendMessageSchema>;

  try {
    body = sendMessageSchema.parse(await request.json());
    await ensureOwnedDocuments(userId, body.documentIds);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Invalid request.",
      400,
    );
  }

  await syncChatDocuments(chatId, body.documentIds);

  const normalizedQuestion = normalizeQuestion(body.question);
  const scopeKey = createScopeKey(body.documentIds);
  const cacheKey = `${chatId}:${scopeKey}:${normalizedQuestion}`;

  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      chatId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: CHAT_MEMORY_WINDOW,
    select: {
      role: true,
      content: true,
    },
  });

  await prisma.chatMessage.create({
    data: {
      chatId,
      role: ChatRole.USER,
      content: body.question,
    },
  });

  if (chat.title === "New chat") {
    await prisma.chat.update({
      where: { id: chatId },
      data: { title: deriveChatTitle(body.question) },
    });
  }

  const cachedResponse =
    responseCache.get(cacheKey) ||
    (await prisma.queryCache.findUnique({
      where: {
        chatId_scopeKey_normalizedQuestion: {
          chatId,
          scopeKey,
          normalizedQuestion,
        },
      },
    }));

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      try {
        const historyMessages = [...recentMessages].reverse();

        if (cachedResponse) {
          const payload = {
            response:
              "response" in cachedResponse
                ? cachedResponse.response
                : FALLBACK_ANSWER,
            confidence: cachedResponse.confidence ?? null,
            sources: normalizeSources(cachedResponse.sources),
          };

          await persistAssistantMessage({
            chatId,
            response: payload.response,
            confidence: payload.confidence,
            sources: payload.sources,
            normalizedQuestion,
            scopeKey,
          });

          responseCache.set(cacheKey, payload);
          emitEvent(controller, "token", { text: payload.response });
          emitEvent(controller, "done", {
            confidence: payload.confidence,
            sources: payload.sources,
          });
          controller.close();
          return;
        }

        const retrieval = await retrieveRelevantSources({
          userId,
          documentIds: body.documentIds,
          question: body.question,
          history: historyMessages,
        });

        if (retrieval.sources.length === 0) {
          const fallback = getFallbackResult();
          await persistAssistantMessage({
            chatId,
            response: fallback.answer,
            confidence: fallback.confidence,
            sources: fallback.sources,
            normalizedQuestion,
            scopeKey,
          });

          responseCache.set(cacheKey, {
            response: fallback.answer,
            confidence: fallback.confidence,
            sources: fallback.sources,
          });

          emitEvent(controller, "token", { text: fallback.answer });
          emitEvent(controller, "done", {
            confidence: fallback.confidence,
            sources: fallback.sources,
          });
          controller.close();
          return;
        }

        const answerStream = await streamAnswerFromContext({
          question: body.question,
          history: historyMessages
            .map((message) => `${message.role}: ${message.content}`)
            .join("\n"),
          sources: retrieval.sources,
        });

        let responseText = "";

        for await (const chunk of answerStream) {
          const text = chunk.text || "";

          if (!text) {
            continue;
          }

          responseText += text;
          emitEvent(controller, "token", { text });
        }

        const finalResponse = responseText.trim() || FALLBACK_ANSWER;
        await persistAssistantMessage({
          chatId,
          response: finalResponse,
          confidence: retrieval.confidence,
          sources: retrieval.sources,
          normalizedQuestion,
          scopeKey,
        });

        responseCache.set(cacheKey, {
          response: finalResponse,
          confidence: retrieval.confidence,
          sources: retrieval.sources,
        });

        emitEvent(controller, "done", {
          confidence: retrieval.confidence,
          sources: retrieval.sources,
        });
        controller.close();
      } catch (error) {
        emitEvent(controller, "error", {
          message: error instanceof Error ? error.message : "Answer generation failed.",
        });
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
