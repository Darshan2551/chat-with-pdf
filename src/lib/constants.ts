export const FALLBACK_ANSWER =
  "I don't know the answer to this specific question based on the provided context. The context contains information from the uploaded document, and it does not include relevant details to answer your question.";

export const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".pptx"];

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const CHAT_MEMORY_WINDOW = 6;
export const CHUNK_SIZE = 3200;
export const CHUNK_OVERLAP = 450;
export const RETRIEVAL_LIMIT = 5;
export const MIN_RELEVANCE_SCORE = 0.18;
