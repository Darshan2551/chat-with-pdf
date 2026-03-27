import { randomUUID } from "node:crypto";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { embedText } from "@/lib/ai/gemini";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
} from "@/lib/constants";
import { splitIntoChunks } from "@/lib/document/chunk";
import { extractDocumentText } from "@/lib/document/extract";
import { getServerEnv } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { invalidateDocumentChunkCache } from "@/lib/rag";
import { prisma } from "@/lib/prisma";
import { writeDocumentToStorage, deleteStoredDocument } from "@/lib/storage";
import type { DashboardDocument } from "@/lib/types";
import { getFileExtension, sanitizeFileName } from "@/lib/utils";

export const runtime = "nodejs";

const toDashboardDocument = (document: {
  id: string;
  originalName: string;
  mimeType: string;
  sizeInBytes: number;
  createdAt: Date;
}): DashboardDocument => ({
  ...document,
  createdAt: document.createdAt.toISOString(),
});

const validateUpload = (file: File) => {
  const extension = getFileExtension(file.name);

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error(`Unsupported file type: ${file.name}`);
  }

  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error(`Unsupported file type: ${file.name}`);
  }

  if (file.size > getServerEnv().maxFileSizeMb * 1024 * 1024) {
    throw new Error(`${file.name} exceeds the file size limit.`);
  }
};

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  const documents = await prisma.document.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeInBytes: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    documents: documents.map(toDashboardDocument),
  });
}

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return jsonError("No files were uploaded.");
    }

    const uploadedDocuments: DashboardDocument[] = [];

    for (const file of files) {
      validateUpload(file);

      const buffer = Buffer.from(await file.arrayBuffer());
      const extractedText = await extractDocumentText(buffer, file.name);

      if (!extractedText) {
        throw new Error(`${file.name} did not contain extractable text.`);
      }

      const chunks = splitIntoChunks(extractedText);

      if (chunks.length === 0) {
        throw new Error(`${file.name} did not produce any text chunks.`);
      }

      const documentId = randomUUID();
      const safeFileName = sanitizeFileName(file.name) || `${documentId}${getFileExtension(file.name)}`;
      let storagePath = "";

      try {
        storagePath = await writeDocumentToStorage({
          userId,
          documentId,
          fileName: safeFileName,
          buffer,
          mimeType: file.type,
        });

        const chunkEmbeddings = [];

        for (const chunk of chunks) {
          const embedding = await embedText(chunk.content);
          chunkEmbeddings.push({
            content: chunk.content,
            tokenEstimate: chunk.tokenEstimate,
            embedding,
          });
        }

        const document = await prisma.document.create({
          data: {
            id: documentId,
            userId,
            fileName: safeFileName,
            originalName: file.name,
            mimeType: file.type,
            sizeInBytes: file.size,
            storagePath,
            textContent: extractedText,
            chunks: {
              create: chunkEmbeddings.map((chunk, index) => ({
                chunkIndex: index,
                content: chunk.content,
                tokenEstimate: chunk.tokenEstimate,
                embedding: chunk.embedding,
              })),
            },
          },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeInBytes: true,
            createdAt: true,
          },
        });

        invalidateDocumentChunkCache(document.id);
        uploadedDocuments.push(toDashboardDocument(document));
      } catch (error) {
        if (storagePath) {
          await deleteStoredDocument(storagePath);
        }

        throw error;
      }
    }

    return NextResponse.json({
      documents: uploadedDocuments,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Upload failed.",
      400,
    );
  }
}
