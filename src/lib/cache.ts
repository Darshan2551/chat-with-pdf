import { LRUCache } from "lru-cache";

import type { SourceSnippet } from "@/lib/types";

type ChunkCacheItem = {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  embedding: number[];
};

type ResponseCacheItem = {
  response: string;
  confidence: number | null;
  sources: SourceSnippet[];
};

export const chunkCache = new LRUCache<string, ChunkCacheItem[]>({
  max: 128,
  ttl: 1000 * 60 * 15,
});

export const responseCache = new LRUCache<string, ResponseCacheItem>({
  max: 256,
  ttl: 1000 * 60 * 10,
});
