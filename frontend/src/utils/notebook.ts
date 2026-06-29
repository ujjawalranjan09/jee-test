/**
 * Local notebook — saved questions grouped by subject › chapter.
 * Persisted in localStorage under `qf_notebook_v1`. Plain JSON; no encryption.
 *
 * Each entry captures everything needed to render the question later (so
 * the user doesn't need the original PDF): prompt, options, the correct
 * answer, the source quiz id, when it was saved, and the topic string
 * (from which subject + chapter are derived).
 */

import type { Question, Quiz } from "../types";

const KEY = "qf_notebook_v1";

export interface NotebookEntry {
  /** Stable id — `<quizId>:<questionId>` so re-saving is idempotent. */
  id: string;
  quizId: string;
  questionId: string;
  /** Free-form topic as the LLM emitted it (e.g. "Algebra › Linear Equations"). */
  topic: string;
  /** Derived: the part before the first " › " in ``topic`` (or "General"). */
  subject: string;
  /** Derived: the part after the first " › " (or the topic itself, or "General"). */
  chapter: string;
  prompt: string;
  options: { id: string; text: string }[];
  correctAnswerId: string;
  diagramIds: string[];
  /** ISO timestamp. */
  savedAt: string;
  /**
   * Provenance from the source quiz. Optional because legacy quizzes may
   * not have these fields set.
   */
  sourceMode?: "extracted" | "generated";
  pageNumber?: number;
}

interface NotebookFile {
  version: 1;
  entries: NotebookEntry[];
}

export function loadNotebook(): NotebookEntry[] {
  return load();
}

function load(): NotebookEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NotebookFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries;
  } catch {
    return [];
  }
}

function save(entries: NotebookEntry[]): void {
  try {
    const file: NotebookFile = { version: 1, entries };
    localStorage.setItem(KEY, JSON.stringify(file));
  } catch {
    /* quota exceeded / privacy mode — silently drop, no UI to crash */
  }
}

/**
 * Derive subject + chapter from the LLM-emitted ``topic`` string.
 * Convention: "Subject › Chapter › Subtopic" — we keep the first two
 * segments and discard deeper nesting for grouping purposes.
 */
export function splitTopic(topic: string | undefined): {
  subject: string;
  chapter: string;
} {
  if (!topic || !topic.trim()) return { subject: "General", chapter: "General" };
  // Normalize separators — accept "›", ">", "/", " - ", ":".
  const parts = topic
    .split(/\s*(?:›|>|\/|\s-\s|\s:\s)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { subject: "General", chapter: "General" };
  if (parts.length === 1) return { subject: parts[0]!, chapter: parts[0]! };
  return { subject: parts[0]!, chapter: parts[1]! };
}

/** Build a notebook entry from a question. */
export function makeEntry(
  quiz: Quiz,
  question: Question,
  fallbackTopic?: string,
): NotebookEntry {
  const topic = (question.topic ?? fallbackTopic ?? "General").trim();
  const { subject, chapter } = splitTopic(topic);
  return {
    id: `${quiz.id}:${question.id}`,
    quizId: quiz.id,
    questionId: question.id,
    topic,
    subject,
    chapter,
    prompt: question.prompt,
    options: question.options.map((o) => ({ id: o.id, text: o.text })),
    correctAnswerId: question.correctAnswerId,
    diagramIds: [...question.diagramIds],
    savedAt: new Date().toISOString(),
    sourceMode: question.sourceMode,
    pageNumber: question.pageNumber,
  };
}

export function isSaved(
  quizId: string,
  questionId: string,
): boolean {
  const id = `${quizId}:${questionId}`;
  return load().some((e) => e.id === id);
}

/** Idempotent — saving the same question twice is a no-op (updates timestamp). */
export function saveQuestion(
  quiz: Quiz,
  question: Question,
  fallbackTopic?: string,
): NotebookEntry[] {
  const all = load();
  const id = `${quiz.id}:${question.id}`;
  const entry = makeEntry(quiz, question, fallbackTopic);
  const idx = all.findIndex((e) => e.id === id);
  if (idx >= 0) {
    all[idx] = entry;
  } else {
    all.unshift(entry); // newest first
  }
  save(all);
  return all;
}

export function removeEntry(id: string): NotebookEntry[] {
  const all = load().filter((e) => e.id !== id);
  save(all);
  return all;
}

export function clearAll(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/** Group entries by subject → chapter for the notebook browser. */
export interface NotebookGroup {
  subject: string;
  chapters: {
    chapter: string;
    entries: NotebookEntry[];
  }[];
  totalCount: number;
}

export function groupBySubjectAndChapter(
  entries: NotebookEntry[],
): NotebookGroup[] {
  const subjectMap = new Map<
    string,
    Map<string, NotebookEntry[]>
  >();

  for (const e of entries) {
    let chapterMap = subjectMap.get(e.subject);
    if (!chapterMap) {
      chapterMap = new Map();
      subjectMap.set(e.subject, chapterMap);
    }
    const list = chapterMap.get(e.chapter) ?? [];
    list.push(e);
    chapterMap.set(e.chapter, list);
  }

  const groups: NotebookGroup[] = [];
  for (const [subject, chapterMap] of subjectMap.entries()) {
    const chapters: { chapter: string; entries: NotebookEntry[] }[] = [];
    let totalCount = 0;
    for (const [chapter, list] of chapterMap.entries()) {
      list.sort(
        (a, b) =>
          new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
      );
      chapters.push({ chapter, entries: list });
      totalCount += list.length;
    }
    chapters.sort((a, b) => a.chapter.localeCompare(b.chapter));
    groups.push({ subject, chapters, totalCount });
  }
  groups.sort((a, b) => a.subject.localeCompare(b.subject));
  return groups;
}