"use client";

import { UserButton } from "@clerk/nextjs";
import { formatDistanceToNow } from "date-fns";
import jsPDF from "jspdf";
import {
  FilePlus2,
  Files,
  Loader2,
  Menu,
  MessageSquare,
  MoonStar,
  PanelLeftClose,
  SendHorizonal,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { FALLBACK_ANSWER } from "@/lib/constants";
import type {
  ChatDetail,
  DashboardChat,
  DashboardDocument,
  DashboardMessage,
} from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

type DashboardShellProps = {
  initialDocuments: DashboardDocument[];
  initialChats: DashboardChat[];
  initialChat: ChatDetail | null;
};

type StreamingState = {
  content: string;
  confidence: number | null;
  sources: DashboardMessage["sources"];
};

const parseEventStream = async (
  stream: ReadableStream<Uint8Array>,
  handlers: {
    onToken: (token: string) => void;
    onDone: (payload: {
      confidence: number | null;
      sources: DashboardMessage["sources"];
    }) => void;
    onError: (message: string) => void;
  },
) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const eventMatch = rawEvent.match(/event: ([^\n]+)/);
      const dataMatch = rawEvent.match(/data: ([\s\S]+)/);

      if (!eventMatch || !dataMatch) {
        continue;
      }

      const payload = JSON.parse(dataMatch[1]);

      if (eventMatch[1] === "token") {
        handlers.onToken(String(payload.text || ""));
      }

      if (eventMatch[1] === "done") {
        handlers.onDone({
          confidence: payload.confidence ?? null,
          sources: payload.sources ?? [],
        });
      }

      if (eventMatch[1] === "error") {
        handlers.onError(String(payload.message || "Something went wrong."));
      }
    }
  }
};

const createPreview = (value: string) =>
  value.length <= 90 ? value : `${value.slice(0, 87).trim()}...`;

export function DashboardShell({
  initialDocuments,
  initialChats,
  initialChat,
}: DashboardShellProps) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [chats, setChats] = useState(initialChats);
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(initialChat);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>(
    initialChat?.documentIds || initialDocuments.map((document) => document.id),
  );
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeMessages = useMemo(() => {
    if (!activeChat) {
      return [];
    }

    if (!streaming) {
      return activeChat.messages;
    }

    return [
      ...activeChat.messages,
      {
        id: "streaming",
        role: "ASSISTANT",
        content: streaming.content || "Thinking...",
        confidence: streaming.confidence,
        createdAt: new Date().toISOString(),
        sources: streaming.sources,
      } satisfies DashboardMessage,
    ];
  }, [activeChat, streaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages]);

  const refreshChat = async (chatId: string) => {
    const response = await fetch(`/api/chats/${chatId}`, { method: "GET" });

    if (!response.ok) {
      throw new Error("Unable to load chat.");
    }

    const data = (await response.json()) as { chat: ChatDetail };
    setActiveChat(data.chat);
    setSelectedDocumentIds(data.chat.documentIds);
    return data.chat;
  };

  const createChat = async (documentIds: string[]) => {
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ documentIds }),
    });

    if (!response.ok) {
      throw new Error("Unable to create chat.");
    }

    const data = (await response.json()) as { chat: DashboardChat };
    setChats((current) => [data.chat, ...current.filter((chat) => chat.id !== data.chat.id)]);
    return data.chat;
  };

  const handleSelectChat = (chatId: string) => {
    startTransition(async () => {
      try {
        setError(null);
        await refreshChat(chatId);
        setSidebarOpen(false);
      } catch (selectionError) {
        setError(
          selectionError instanceof Error
            ? selectionError.message
            : "Unable to open the chat.",
        );
      }
    });
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));

    setIsUploading(true);
    setError(null);

    try {
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as {
        documents?: DashboardDocument[];
        error?: string;
      };

      if (!response.ok || !data.documents) {
        throw new Error(data.error || "Upload failed.");
      }

      setDocuments((current) => [...data.documents!, ...current]);
      setSelectedDocumentIds((current) => {
        const merged = new Set(current);
        data.documents!.forEach((document) => merged.add(document.id));
        return [...merged];
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      setError(null);
      const response = await fetch(`/api/files/${documentId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Unable to delete file.");
      }

      setDocuments((current) => current.filter((document) => document.id !== documentId));
      setSelectedDocumentIds((current) => current.filter((id) => id !== documentId));

      if (activeChat?.documentIds.includes(documentId)) {
        await refreshChat(activeChat.id);
      }
    } catch (deletionError) {
      setError(
        deletionError instanceof Error
          ? deletionError.message
          : "Unable to delete the document.",
      );
    }
  };

  const handleNewChat = async () => {
    try {
      setError(null);
      const nextChat = await createChat(selectedDocumentIds);
      await refreshChat(nextChat.id);
      setSidebarOpen(false);
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : "Unable to start a new chat.",
      );
    }
  };

  const handleExportPdf = () => {
    if (!activeChat) {
      return;
    }

    const doc = new jsPDF();
    let cursor = 20;

    doc.setFontSize(16);
    doc.text(activeChat.title, 14, cursor);
    cursor += 12;
    doc.setFontSize(11);

    activeChat.messages.forEach((message) => {
      const role = message.role === "USER" ? "User" : "Assistant";
      const lines = doc.splitTextToSize(`${role}: ${message.content}`, 180);

      if (cursor + lines.length * 6 > 280) {
        doc.addPage();
        cursor = 20;
      }

      doc.text(lines, 14, cursor);
      cursor += lines.length * 6 + 6;
    });

    doc.save(`${activeChat.title.replace(/\s+/g, "-").toLowerCase()}.pdf`);
  };

  const handleSendMessage = async () => {
    if (!prompt.trim()) {
      return;
    }

    if (selectedDocumentIds.length === 0) {
      setError("Select at least one document before asking a question.");
      return;
    }

    const question = prompt.trim();
    setPrompt("");
    setError(null);

    let chat = activeChat;

    if (!chat) {
      try {
        const createdChat = await createChat(selectedDocumentIds);
        chat = await refreshChat(createdChat.id);
      } catch (creationError) {
        setError(
          creationError instanceof Error
            ? creationError.message
            : "Unable to create the chat.",
        );
        setPrompt(question);
        return;
      }
    }

    const optimisticUserMessage: DashboardMessage = {
      id: `user-${Date.now()}`,
      role: "USER",
      content: question,
      confidence: null,
      createdAt: new Date().toISOString(),
      sources: [],
    };

    setActiveChat((current) =>
      current
        ? { ...current, messages: [...current.messages, optimisticUserMessage] }
        : current,
    );
    setStreaming({ content: "", confidence: null, sources: [] });

    try {
      const response = await fetch(`/api/chats/${chat.id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          documentIds: selectedDocumentIds,
        }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Unable to send the message.");
      }

      await parseEventStream(response.body, {
        onToken: (token) => {
          setStreaming((current) => ({
            content: `${current?.content || ""}${token}`,
            confidence: current?.confidence ?? null,
            sources: current?.sources || [],
          }));
        },
        onDone: ({ confidence, sources }) => {
          setStreaming((current) => ({
            content: current?.content || FALLBACK_ANSWER,
            confidence,
            sources,
          }));
        },
        onError: (message) => {
          throw new Error(message);
        },
      });

      const refreshed = await refreshChat(chat.id);
      setChats((current) => [
        {
          id: refreshed.id,
          title: refreshed.title,
          updatedAt: new Date().toISOString(),
          documentIds: refreshed.documentIds,
          lastMessagePreview: createPreview(
            refreshed.messages[refreshed.messages.length - 1]?.content || question,
          ),
        },
        ...current.filter((item) => item.id !== refreshed.id),
      ]);
    } catch (messageError) {
      setError(
        messageError instanceof Error
          ? messageError.message
          : "Unable to get an answer.",
      );
      setActiveChat((current) =>
        current
          ? {
              ...current,
              messages: current.messages.filter(
                (message) => message.id !== optimisticUserMessage.id,
              ),
            }
          : current,
      );
      setPrompt(question);
    } finally {
      setStreaming(null);
    }
  };

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-20 w-[320px] border-r border-[var(--border)] bg-[var(--surface-strong)] p-4 shadow-[var(--shadow)] backdrop-blur transition md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-full flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                Workspace
              </p>
              <h1 className="mt-1 text-xl font-semibold">Chat With Your PDF</h1>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-full border border-[var(--border)] p-2 md:hidden"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <UserButton />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Protected workspace</p>
              <p className="truncate text-sm text-[var(--muted)]">
                Files and chats are isolated per user.
              </p>
            </div>
            <ThemeToggle />
          </div>

          <section className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Documents</p>
                <p className="text-sm text-[var(--muted)]">
                  Upload and select the context to search.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.pptx"
                className="hidden"
                onChange={(event) => void handleUpload(event.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FilePlus2 className="h-4 w-4" />
                )}
                Upload
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {documents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted)]">
                  Upload a file to start building a grounded retrieval index.
                </div>
              ) : (
                documents.map((document) => {
                  const selected = selectedDocumentIds.includes(document.id);

                  return (
                    <label
                      key={document.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 transition",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--border)] bg-transparent",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setSelectedDocumentIds((current) =>
                            current.includes(document.id)
                              ? current.filter((id) => id !== document.id)
                              : [...current, document.id],
                          )
                        }
                        className="mt-1 h-4 w-4 rounded border-[var(--border)]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{document.originalName}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {formatBytes(document.sizeInBytes)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          void handleDeleteDocument(document.id);
                        }}
                        className="rounded-full p-2 text-[var(--muted)] transition hover:text-red-500"
                        aria-label={`Delete ${document.originalName}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </label>
                  );
                })
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Chats</p>
                <p className="text-sm text-[var(--muted)]">Memory is kept per conversation.</p>
              </div>
              <button
                type="button"
                onClick={() => void handleNewChat()}
                className="rounded-full border border-[var(--border)] px-3 py-2 text-sm transition hover:border-[var(--accent)]"
              >
                New chat
              </button>
            </div>

            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {chats.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted)]">
                  Your uploaded documents and answers will start appearing here.
                </div>
              ) : (
                chats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => handleSelectChat(chat.id)}
                    className={cn(
                      "w-full rounded-2xl border px-4 py-3 text-left transition",
                      activeChat?.id === chat.id
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border)]",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-[var(--accent)]" />
                      <p className="truncate text-sm font-medium">{chat.title}</p>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">
                      {chat.lastMessagePreview || "No messages yet."}
                    </p>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Updated {formatDistanceToNow(new Date(chat.updatedAt))} ago
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col px-4 py-4 md:px-6">
        <header className="mb-4 flex items-center justify-between rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-full border border-[var(--border)] p-2 md:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                Document assistant only
              </p>
              <h2 className="text-lg font-semibold">
                {activeChat?.title || "Start a grounded conversation"}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={!activeChat}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-sm transition enabled:hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export PDF
          </button>
        </header>

        <main className="flex min-h-0 flex-1 flex-col rounded-[2rem] border border-[var(--border)] bg-[var(--surface-strong)] shadow-[var(--shadow)] backdrop-blur">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Files className="h-4 w-4 text-[var(--accent)]" />
              {selectedDocumentIds.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  Select at least one document to enable answering.
                </p>
              ) : (
                documents
                  .filter((document) => selectedDocumentIds.includes(document.id))
                  .map((document) => (
                    <span
                      key={document.id}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm text-[var(--muted)]"
                    >
                      {document.originalName}
                    </span>
                  ))
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {activeMessages.length === 0 ? (
              <div className="mx-auto mt-12 max-w-2xl rounded-[1.75rem] border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
                <MoonStar className="mx-auto h-8 w-8 text-[var(--accent)]" />
                <h3 className="mt-4 text-2xl font-semibold">
                  Grounded answers start with grounded context
                </h3>
                <p className="mt-3 leading-7 text-[var(--muted)]">
                  Upload a document, select it in the sidebar, then ask a question.
                  If the answer is not in the retrieved chunks, the assistant will
                  return the strict fallback response instead of guessing.
                </p>
              </div>
            ) : (
              activeMessages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    "max-w-3xl rounded-[1.5rem] border px-4 py-4",
                    message.role === "USER"
                      ? "ml-auto border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
                      : "border-[var(--border)] bg-[var(--surface)]",
                  )}
                >
                  <p className="whitespace-pre-wrap leading-7">{message.content}</p>
                  {message.role === "ASSISTANT" && (
                    <div className="mt-4 border-t border-[var(--border)] pt-4">
                      <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
                        <span>
                          Confidence: {message.confidence !== null ? `${message.confidence}%` : "pending"}
                        </span>
                        <span>Sources: {message.sources.length}</span>
                      </div>
                      {message.sources.length > 0 && (
                        <div className="mt-3 space-y-3">
                          {message.sources.map((source) => (
                            <div
                              key={`${message.id}-${source.chunkId}`}
                              className="rounded-2xl border border-[var(--border)] bg-[var(--accent-soft)] p-3"
                            >
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                                {source.documentName}
                              </p>
                              <p className="mt-2 text-sm leading-6 text-[var(--foreground)]">
                                {source.excerpt}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-[var(--border)] px-5 py-4">
            {error ? (
              <div className="mb-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                {error}
              </div>
            ) : null}
            <div className="flex items-end gap-3">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSendMessage();
                  }
                }}
                rows={3}
                placeholder="Ask a question about the selected document context..."
                className="min-h-[90px] flex-1 resize-none rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none transition focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={() => void handleSendMessage()}
                disabled={isPending || isUploading || selectedDocumentIds.length === 0}
                className="inline-flex h-14 items-center gap-2 rounded-full bg-[var(--accent)] px-5 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SendHorizonal className="h-4 w-4" />
                )}
                Send
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
