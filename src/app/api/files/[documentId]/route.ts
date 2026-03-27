import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { invalidateDocumentChunkCache } from "@/lib/rag";
import { deleteStoredDocument } from "@/lib/storage";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { userId } = await auth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  const { documentId } = await params;
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      userId,
    },
  });

  if (!document) {
    return jsonError("Document not found.", 404);
  }

  await prisma.document.delete({
    where: {
      id: document.id,
    },
  });

  await deleteStoredDocument(document.storagePath);
  invalidateDocumentChunkCache(document.id);

  return NextResponse.json({ success: true });
}
