"use client";

import { Moon, SunMedium } from "lucide-react";

import { useAppTheme } from "@/components/providers";

export function ThemeToggle() {
  const { mounted, theme, setTheme } = useAppTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] transition hover:border-[var(--accent)]"
      aria-label="Toggle theme"
    >
      {mounted && isDark ? (
        <SunMedium className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}
