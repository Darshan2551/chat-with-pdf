import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { DashboardShell } from "@/components/dashboard-shell";
import { getChatDetail, getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const data = await getDashboardData(userId);
  const firstChat = data.chats[0];
  const initialChat = firstChat ? await getChatDetail(userId, firstChat.id) : null;

  return (
    <DashboardShell
      initialChat={initialChat}
      initialChats={data.chats}
      initialDocuments={data.documents}
    />
  );
}
