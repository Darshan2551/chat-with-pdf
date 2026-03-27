import { auth } from "@clerk/nextjs/server";

import { getChatDetail } from "@/lib/dashboard";
import { jsonError } from "@/lib/http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { userId } = await auth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  const { chatId } = await params;
  const chat = await getChatDetail(userId, chatId);

  if (!chat) {
    return jsonError("Chat not found.", 404);
  }

  return Response.json({ chat });
}
