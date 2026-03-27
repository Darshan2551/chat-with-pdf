import "server-only";

import { GoogleGenAI } from "@google/genai";

import { FALLBACK_ANSWER } from "@/lib/constants";
import { getServerEnv } from "@/lib/env";
import type { SourceSnippet } from "@/lib/types";

let client: GoogleGenAI | null = null;

const getClient = () => {
  if (!client) {
    client = new GoogleGenAI({
      apiKey: getServerEnv().geminiApiKey,
    });
  }

  return client;
};

const buildPrompt = ({
  context,
  question,
  history,
}: {
  context: string;
  question: string;
  history: string;
}) => `
You are Chat With Your PDF.

You are a document assistant only.
Answer strictly and exclusively from the supplied document context.
Do not use outside knowledge.
Do not infer facts that are not explicitly supported.
If the answer is not fully supported by the context, respond with this exact sentence and nothing else:
${FALLBACK_ANSWER}

Conversation memory is included only to resolve follow-up references. It is not source material.

Conversation memory:
${history || "No previous chat history."}

Document context:
${context}

Question:
${question}

Respond with a concise answer grounded in the context only.
`;

export const embedText = async (text: string) => {
  const response = await getClient().models.embedContent({
    model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    contents: text,
  });

  const values = response.embeddings?.[0]?.values;

  if (!values || values.length === 0) {
    throw new Error("Embedding generation returned no values.");
  }

  return values;
};

export const streamAnswerFromContext = async (params: {
  question: string;
  history: string;
  sources: SourceSnippet[];
}) => {
  const context = params.sources
    .map(
      (source, index) =>
        `[Source ${index + 1} | ${source.documentName} | score=${source.score.toFixed(3)}]\n${source.excerpt}`,
    )
    .join("\n\n");

  return getClient().models.generateContentStream({
    model: process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash",
    config: {
      temperature: 0,
    },
    contents: buildPrompt({
      context,
      question: params.question,
      history: params.history,
    }),
  });
};
