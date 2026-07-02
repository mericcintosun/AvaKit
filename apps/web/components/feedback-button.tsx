"use client";

import { MessageSquareText } from "lucide-react";
import { useLocale } from "next-intl";

import { FEEDBACK_FORM_URL, getContent, type Locale } from "@/lib/content";

/** Small, always-visible feedback pill pinned to the bottom-right. Opens the
 *  Google Form (NEXT_PUBLIC_FEEDBACK_FORM_URL) in a new tab. */
export function FeedbackButton() {
  const c = getContent(useLocale() as Locale);
  return (
    <a
      href={FEEDBACK_FORM_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={c.feedback}
      className="bg-background/90 hover:bg-primary hover:text-primary-foreground hover:border-primary fixed right-4 bottom-4 z-50 inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur transition-colors"
    >
      <MessageSquareText className="size-4" />
      <span className="hidden sm:inline">{c.feedback}</span>
    </a>
  );
}
