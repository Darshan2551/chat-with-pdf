# Chat With Your PDF

A full-stack Next.js application that lets authenticated users upload `PDF`, `DOCX`, and `PPTX` files, then ask questions answered strictly from the uploaded document context.

## Tech Stack

- Frontend: Next.js 16 + React 19 + Tailwind CSS 4
- Backend: Next.js App Router route handlers
- Auth: Clerk
- Database: PostgreSQL + Prisma ORM
- Embeddings + LLM: Google Gemini via `@google/genai`
- Retrieval store: PostgreSQL-persisted embeddings with in-memory similarity cache
- File parsing: `pdf-parse`, `mammoth`, `jszip`, `fast-xml-parser`
- Deployment storage: local filesystem for development or S3-compatible object storage for production

## Core Behavior

- Only authenticated users can access uploads and chats.
- Every document and every chat is scoped to the current Clerk user.
- Answers are grounded only in retrieved document chunks.
- If the answer is not supported by retrieved context, the assistant returns this exact fallback:

```text
I don't know the answer to this specific question based on the provided context. The context contains information from the uploaded document, and it does not include relevant details to answer your question.
```

## Folder Structure

```text
.
├── prisma
│   └── schema.prisma
├── src
│   ├── app
│   │   ├── api
│   │   │   ├── chats
│   │   │   └── files
│   │   ├── dashboard
│   │   ├── sign-in
│   │   ├── sign-up
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components
│   │   ├── dashboard-shell.tsx
│   │   ├── providers.tsx
│   │   └── theme-toggle.tsx
│   ├── lib
│   │   ├── ai
│   │   │   └── gemini.ts
│   │   ├── document
│   │   │   ├── chunk.ts
│   │   │   └── extract.ts
│   │   ├── cache.ts
│   │   ├── chat.ts
│   │   ├── constants.ts
│   │   ├── dashboard.ts
│   │   ├── env.ts
│   │   ├── http.ts
│   │   ├── prisma.ts
│   │   ├── rag.ts
│   │   ├── storage.ts
│   │   ├── types.ts
│   │   └── utils.ts
│   └── proxy.ts
├── .dockerignore
├── .env.example
├── Dockerfile
├── next.config.ts
└── package.json
```

## How It Works

### 1. Authentication

- Clerk proxy protects all routes except `/`, `/sign-in`, and `/sign-up`.
- The dashboard and APIs read the current Clerk `userId`.
- Queries always filter by `userId` so users cannot access each other’s files or chats.

### 2. Upload Pipeline

When a user uploads files:

1. The API validates file type and file size.
2. The file is stored using the configured provider:
   - `local` writes to `storage/`
   - `s3` writes to an S3-compatible bucket
3. Text is extracted:
   - PDF: `pdf-parse`
   - DOCX: `mammoth`
   - PPTX: Open XML slide parsing with `jszip`
4. Text is split into overlapping chunks.
5. Gemini embeddings are generated per chunk.
6. Document metadata and chunk embeddings are stored in PostgreSQL.

### 3. Retrieval-Augmented Generation

When the user asks a question:

1. The question is normalized and cached per chat + selected document set.
2. Recent chat memory is appended for follow-up resolution.
3. Gemini creates an embedding for the retrieval query.
4. Stored chunk embeddings are loaded and ranked with cosine similarity.
5. The top chunk excerpts are sent to Gemini with a strict prompt.
6. The answer is streamed back to the UI and stored in chat history.

### 4. Strict Answering Rule

The application enforces document-only behavior in two ways:

- Retrieval filters context to the user-selected documents only.
- The prompt explicitly forbids outside knowledge and instructs the model to output the exact fallback sentence when the answer is not supported.

If retrieval finds no relevant chunks, the API skips generation entirely and returns the fallback immediately.

## Database Models

The Prisma schema includes:

- `Document`: uploaded file metadata and extracted text
- `DocumentChunk`: chunk text + embedding vectors
- `Chat`: per-user conversation container
- `ChatDocument`: many-to-many relationship between chats and selected documents
- `ChatMessage`: user/assistant turns with sources and confidence
- `QueryCache`: repeated-query cache scoped by chat and document selection

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required variables:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/chat_with_your_pdf?schema=public"
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_your_key"
CLERK_SECRET_KEY="sk_test_your_key"
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
GEMINI_API_KEY="your_gemini_api_key"
MAX_FILE_SIZE_MB="15"
```

Optional variables:

```env
GEMINI_CHAT_MODEL="gemini-2.5-flash"
GEMINI_EMBEDDING_MODEL="gemini-embedding-001"
STORAGE_PROVIDER="local"
S3_BUCKET=""
S3_REGION=""
S3_ENDPOINT=""
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
S3_FORCE_PATH_STYLE="false"
```

## Clerk Setup

1. Create a Clerk application.
2. Enable email/password or any preferred sign-in method.
3. Add the keys to `.env`.
4. In Clerk dashboard, set:
   - Sign-in URL: `/sign-in`
   - Sign-up URL: `/sign-up`
   - After sign-in URL: `/dashboard`
   - After sign-up URL: `/dashboard`

## Google Gemini Setup

1. Go to Google AI Studio.
2. Create an API key.
3. Add it as `GEMINI_API_KEY` in `.env`.
4. The server uses:
   - Chat model: `gemini-2.5-flash` by default
   - Embedding model: `gemini-embedding-001` by default

## PostgreSQL Setup

1. Create a PostgreSQL database.
2. Update `DATABASE_URL` in `.env`.
3. Generate the Prisma client:

```bash
npm run db:generate
```

4. Apply the schema:

```bash
npm run db:migrate -- --name init
```

If you only want to sync the schema quickly in development:

```bash
npm run db:push
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Production Build

```bash
npm run build
npm start
```

## Recommended Production Target

Recommended default:

- Deploy the container to Render, Railway, Fly.io, ECS, or another Node/Docker host
- Keep PostgreSQL in Prisma Postgres, Neon, Supabase, or RDS
- Set `STORAGE_PROVIDER="s3"` and point it at S3, Cloudflare R2, Backblaze B2, or another S3-compatible bucket

Why this is the safest default:

- The app supports multi-file uploads larger than basic image payloads.
- Production object storage avoids ephemeral filesystem issues.
- `next.config.ts` uses `output: "standalone"` and the repository includes a `Dockerfile`.

## Docker Deployment

Build locally:

```bash
docker build -t chat-with-your-pdf .
```

Run locally:

```bash
docker run --env-file .env -p 3000:3000 chat-with-your-pdf
```

For a production deploy, make sure these are set:

```env
DATABASE_URL=""
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
CLERK_SECRET_KEY=""
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
GEMINI_API_KEY=""
STORAGE_PROVIDER="s3"
S3_BUCKET=""
S3_REGION=""
S3_ENDPOINT=""
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
S3_FORCE_PATH_STYLE="false"
```

## Key Features Implemented

- Clerk-protected application shell
- PDF, DOCX, and PPTX uploads
- Chunking + embedding generation
- Retrieval over persisted embeddings
- Strict document-only answering
- Follow-up memory from recent chat turns
- Per-user chat history
- Multiple documents per chat
- File deletion
- Response streaming
- Repeated-query caching
- Source excerpts and confidence display
- Chat export as PDF
- Responsive UI with dark mode
- Production-ready S3-compatible storage backend

## Security Notes

- Uploads are restricted to specific file types.
- File size is validated server-side.
- All APIs verify the authenticated Clerk user.
- Document ownership is checked before retrieval or deletion.
- Chat ownership is checked before reading or writing messages.
- In production, use object storage instead of local disk.

## API Routes

- `GET /api/files`
- `POST /api/files`
- `DELETE /api/files/:documentId`
- `POST /api/chats`
- `GET /api/chats/:chatId`
- `POST /api/chats/:chatId/messages`

## Beginner-Friendly Implementation Map

If you want to understand the code in order:

1. Start with [`prisma/schema.prisma`](./prisma/schema.prisma)
2. Read [`src/proxy.ts`](./src/proxy.ts)
3. Read [`src/lib/document/extract.ts`](./src/lib/document/extract.ts)
4. Read [`src/lib/document/chunk.ts`](./src/lib/document/chunk.ts)
5. Read [`src/lib/rag.ts`](./src/lib/rag.ts)
6. Read [`src/lib/storage.ts`](./src/lib/storage.ts)
7. Read [`src/app/api/files/route.ts`](./src/app/api/files/route.ts)
8. Read [`src/app/api/chats/[chatId]/messages/route.ts`](./src/app/api/chats/[chatId]/messages/route.ts)
9. Read [`src/components/dashboard-shell.tsx`](./src/components/dashboard-shell.tsx)

## Verification

The project has been verified with:

```bash
npm run lint
npm run build
```
