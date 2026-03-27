import type { ChatRole } from "@prisma/client";

export type SourceSnippet = {
  chunkId: string;
  documentId: string;
  documentName: string;
  excerpt: string;
  score: number;
};

export type DashboardDocument = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeInBytes: number;
  createdAt: string;
};

export type DashboardMessage = {
  id: string;
  role: ChatRole;
  content: string;
  confidence: number | null;
  createdAt: string;
  sources: SourceSnippet[];
};

export type DashboardChat = {
  id: string;
  title: string;
  updatedAt: string;
  documentIds: string[];
  lastMessagePreview: string | null;
};

export type ChatDetail = {
  id: string;
  title: string;
  documentIds: string[];
  messages: DashboardMessage[];
};
