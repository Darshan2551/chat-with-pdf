import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
} from "@/lib/constants";
import { estimateTokens } from "@/lib/utils";

export const splitIntoChunks = (text: string) => {
  const normalized = text.trim();

  if (!normalized) {
    return [];
  }

  const chunks: { content: string; tokenEstimate: number }[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + CHUNK_SIZE, normalized.length);

    if (end < normalized.length) {
      const windowStart = Math.max(start + Math.floor(CHUNK_SIZE * 0.6), start);
      const slice = normalized.slice(windowStart, end);
      const breakOffset = Math.max(
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! "),
      );

      if (breakOffset > 0) {
        end = windowStart + breakOffset + 1;
      }
    }

    const content = normalized.slice(start, end).trim();

    if (content) {
      chunks.push({
        content,
        tokenEstimate: estimateTokens(content),
      });
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP, 0);
  }

  return chunks;
};
