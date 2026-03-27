import "server-only";

import { ChatRole } from "@prisma/client";

import {
  CHAT_MEMORY_WINDOW,
  FALLBACK_ANSWER,
  MIN_RELEVANCE_SCORE,
  RETRIEVAL_LIMIT,
} from "@/lib/constants";
import { chunkCache } from "@/lib/cache";
import { embedText } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import type { SourceSnippet } from "@/lib/types";
import { cosineSimilarity } from "@/lib/utils";

type StoredChunk = {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  embedding: number[];
};

const getHistoryText = (
  history: { role: ChatRole; content: string }[],
  question: string,
) =>
  history
    .slice(-CHAT_MEMORY_WINDOW)
    .map((message) => `${message.role}: ${message.content}`)
    .concat(`USER: ${question}`)
    .join("\n");

const clipExcerpt = (content: string) =>
  content.length <= 700 ? content : `${content.slice(0, 697).trim()}...`;

const loadDocumentChunks = async (userId: string, documentIds: string[]) => {
  const allChunks: StoredChunk[] = [];
  const missingIds: string[] = [];

  for (const documentId of documentIds) {
    const cached = chunkCache.get(documentId);

    if (cached) {
      allChunks.push(...cached);
      continue;
    }

    missingIds.push(documentId);
  }

  if (missingIds.length === 0) {
    return allChunks;
  }

  for (const documentId of missingIds) {
    const chunks = await prisma.documentChunk.findMany({
      where: {
        documentId,
        document: {
          userId,
        },
      },
      orderBy: {
        chunkIndex: "asc",
      },
      include: {
        document: {
          select: {
            originalName: true,
          },
        },
      },
    });

    const normalized = chunks.map((chunk) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.document.originalName,
      content: chunk.content,
      embedding: Array.isArray(chunk.embedding)
        ? chunk.embedding.map((value) => Number(value))
        : [],
    }));

    chunkCache.set(documentId, normalized);
    allChunks.push(...normalized);
  }

  return allChunks;
};

export const invalidateDocumentChunkCache = (documentId: string) => {
  chunkCache.delete(documentId);
};

export const retrieveRelevantSources = async (params: {
  userId: string;
  documentIds: string[];
  question: string;
  history: { role: ChatRole; content: string }[];
}) => {
  const retrievalQuery = getHistoryText(params.history, params.question);
  const queryEmbedding = await embedText(retrievalQuery);
  const chunks = await loadDocumentChunks(params.userId, params.documentIds);

  if (chunks.length === 0) {
    return {
      confidence: 0,
      sources: [] as SourceSnippet[],
    };
  }

  const ranked = chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, RETRIEVAL_LIMIT)
    .filter((entry) => entry.score >= MIN_RELEVANCE_SCORE);

  const sources = ranked.map(({ chunk, score }) => ({
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    excerpt: clipExcerpt(chunk.content),
    score,
  }));

  return {
    confidence: sources[0] ? Math.round(((sources[0].score + 1) / 2) * 100) : 0,
    sources,
  };
};

export const getFallbackResult = () => ({
  answer: FALLBACK_ANSWER,
  confidence: 0,
  sources: [] as SourceSnippet[],
});
