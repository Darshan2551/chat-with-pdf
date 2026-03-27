import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowRight, FileStack, LockKeyhole, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";

export default async function HomePage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen px-6 py-8 md:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex items-center justify-between rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 shadow-[var(--shadow)] backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-[var(--muted)]">
            Chat With Your PDF
          </p>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/sign-in"
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
            >
              Log in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Start free
            </Link>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface-strong)] p-8 shadow-[var(--shadow)] backdrop-blur md:p-12">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-1 font-mono text-xs uppercase tracking-[0.26em] text-[var(--accent)]">
              <Sparkles className="h-3.5 w-3.5" />
              Retrieval-grounded answers
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
              Ask your documents questions and get answers from the text, not from guesses.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              Upload PDFs, DOCX files, or slide decks. The app extracts the
              content, builds embeddings, retrieves the most relevant chunks,
              and answers only from the supplied document context.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-5 py-3 font-medium text-[var(--background)] transition hover:opacity-90"
              >
                Build your workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-5 py-3 font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]"
              >
                Open sign in
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            {[
              {
                icon: FileStack,
                title: "Multi-format ingestion",
                copy: "Supports PDF, DOCX, and PPTX uploads with chunking and embedding generation.",
              },
              {
                icon: LockKeyhole,
                title: "User-isolated workspace",
                copy: "Clerk auth, protected routes, separate files per user, and isolated chat history.",
              },
              {
                icon: Sparkles,
                title: "Strict document assistant",
                copy: "If a question is not answered in the retrieved context, the app returns the fallback response exactly.",
              },
            ].map((item) => (
              <article
                key={item.title}
                className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow)] backdrop-blur"
              >
                <item.icon className="h-5 w-5 text-[var(--accent)]" />
                <h2 className="mt-4 text-xl font-semibold">{item.title}</h2>
                <p className="mt-2 leading-7 text-[var(--muted)]">{item.copy}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
