/**
 * Share quiz via URL — client-side encoding, no backend storage needed.
 * Quiz data is compressed and encoded into the URL hash fragment.
 */

import type { Quiz } from "../types";

interface SharedQuizData {
  quiz: Quiz;
  sharedAt: string;
  version: number;
}

const SHARE_VERSION = 1;
const HASH_PREFIX = "#quiz=";

/**
 * Encode a quiz into a URL-safe string.
 * Strips base64 image data to keep URL manageable (diagrams can be huge).
 */
export function encodeQuizForShare(quiz: Quiz): string {
  // Strip diagram image data — too large for URLs
  const lightweightQuiz: Quiz = {
    ...quiz,
    diagrams: {}, // Remove diagrams from shared data
    questions: quiz.questions.map((q) => ({
      ...q,
      diagramIds: [], // Clear diagram references too
    })),
  };

  const data: SharedQuizData = {
    quiz: lightweightQuiz,
    sharedAt: new Date().toISOString(),
    version: SHARE_VERSION,
  };

  const json = JSON.stringify(data);
  // Use encodeURIComponent for URL safety (base64 can have +, /, =)
  return btoa(unescape(encodeURIComponent(json)));
}

/**
 * Build a full shareable URL from the current page + encoded quiz.
 */
export function buildShareUrl(quiz: Quiz): string {
  const encoded = encodeQuizForShare(quiz);
  const base = window.location.origin + window.location.pathname;
  return `${base}${HASH_PREFIX}${encoded}`;
}

/**
 * Check if the current URL contains a shared quiz.
 */
export function hasSharedQuiz(): boolean {
  return window.location.hash.startsWith(HASH_PREFIX);
}

/**
 * Decode a shared quiz from the current URL hash.
 * Returns null if no valid quiz found.
 */
export function decodeSharedQuiz(): Quiz | null {
  try {
    const hash = window.location.hash;
    if (!hash.startsWith(HASH_PREFIX)) return null;

    const encoded = hash.slice(HASH_PREFIX.length);
    const json = decodeURIComponent(escape(atob(encoded)));
    const data = JSON.parse(json) as SharedQuizData;

    if (data.version !== SHARE_VERSION || !data.quiz?.questions?.length) {
      return null;
    }

    // Clear the hash after decoding (clean URL)
    window.history.replaceState(null, "", window.location.pathname);

    return data.quiz;
  } catch {
    return null;
  }
}

/**
 * Copy text to clipboard with fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
