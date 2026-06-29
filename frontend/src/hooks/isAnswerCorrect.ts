/**
 * Per-type answer grading. Used by:
 *   - useQuizSession (lives: deduct on wrong)
 *   - QuizPlayer (optional inline correctness feedback)
 *   - ReviewView (compute per-question correct/incorrect badge)
 *
 *   single    : userPicked string (one option id), expected = question.correctAnswerId
 *   multiple  : userPicked string[] (set of option ids), expected = question.correctAnswerIds
 *               (all-or-nothing — partial selections count as wrong)
 *   numerical : userPicked number, expected = question.numericalAnswer ± tolerance
 *
 * Returns `null` (not undefined, not false) when the question has no
 * answer key, so the UI can show "answer not provided" rather than
 * "wrong". `false` is reserved for "answered and wrong".
 */

import type { Question } from "../types";

/** Case-insensitive set equality for letter strings. */
function setEqualCI(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const A = a.map((s) => s.trim().toLowerCase()).sort();
  const B = b.map((s) => s.trim().toLowerCase()).sort();
  return A.every((v, i) => v === B[i]);
}

export function isAnswerCorrect(
  question: Question,
  /** single (string) or multiple (string[]). Undefined for unanswered / wrong type. */
  userPicked: string | string[] | null | undefined,
  /** numerical: the user's typed number. Undefined for single / multiple. */
  userNumerical: number | null | undefined,
): boolean | null {
  const qtype = question.type ?? "single";

  if (qtype === "single") {
    if (typeof userPicked !== "string") return null;
    if (!question.correctAnswerId) return null; // no key
    return (
      userPicked.trim().toLowerCase() ===
      question.correctAnswerId.trim().toLowerCase()
    );
  }

  if (qtype === "multiple") {
    if (!Array.isArray(userPicked) || userPicked.length === 0) return null;
    const expected = question.correctAnswerIds ?? [];
    if (expected.length === 0) return null; // no key
    return setEqualCI(userPicked, expected);
  }

  // numerical
  if (typeof userNumerical !== "number" || !Number.isFinite(userNumerical)) {
    return null;
  }
  if (question.numericalAnswer == null) return null; // no key
  const tol = question.numericalTolerance ?? 0;
  return Math.abs(userNumerical - question.numericalAnswer) <= tol;
}

/** Helper: which answer field should we use for a question type? */
export function isQuestionAnswered(
  question: Question,
  answer: AnswerStateLike | undefined,
): boolean {
  if (!answer) return false;
  const qtype = question.type ?? "single";
  if (qtype === "single") return answer.selectedOptionId !== null;
  if (qtype === "multiple")
    return Array.isArray(answer.selectedOptionIds) &&
      answer.selectedOptionIds.length > 0;
  // numerical: any finite number (including 0 / negatives) counts as answered.
  return (
    typeof answer.numericalAnswer === "number" &&
    Number.isFinite(answer.numericalAnswer)
  );
}

/** Minimal shape for `isQuestionAnswered` — accepts the full AnswerState
 *  or just the relevant answer fields. */
export interface AnswerStateLike {
  selectedOptionId?: string | null;
  selectedOptionIds?: string[];
  numericalAnswer?: number | null;
}
