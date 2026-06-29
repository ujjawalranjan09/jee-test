import { describe, it, expect } from "vitest";
import { scoreQuiz, type ScoreResult } from "../utils/scoring";
import type { QuizSession, Quiz, AnswerState } from "../types";

function makeQuiz(correctIds: string[]): Quiz {
  return {
    id: "quiz-1",
    questions: correctIds.map((cid, i) => ({
      id: `q${i}`,
      prompt: `Question ${i}`,
      options: [
        { id: "a", text: "Option A" },
        { id: "b", text: "Option B" },
        { id: cid, text: "Correct" },
      ],
      correctAnswerId: cid,
      diagramIds: [],
    })),
    diagrams: {},
  };
}

function makeSession(
  quiz: Quiz,
  answers: Record<string, string | null>,
): QuizSession {
  const answerStates: Record<string, AnswerState> = {};
  for (const q of quiz.questions) {
    answerStates[q.id] = {
      questionId: q.id,
      selectedOptionId: answers[q.id] ?? null,
      markedForReview: false,
    };
  }
  return {
    quiz,
    answers: answerStates,
    config: {
      lives: { enabled: false, total: 3 },
      timePerQuestion: { enabled: false, durationMinutes: 2 },
      overallTime: { enabled: false, totalMinutes: 30 },
      generationMode: "generate",
    },
    status: "ended",
  };
}

describe("scoreQuiz", () => {
  it("scores all correct", () => {
    const quiz = makeQuiz(["c", "c", "c"]);
    const session = makeSession(quiz, { q0: "c", q1: "c", q2: "c" });
    const result = scoreQuiz(session);
    expect(result).toEqual({ correct: 3, incorrect: 0, unanswered: 0, total: 3 });
  });

  it("scores all incorrect", () => {
    const quiz = makeQuiz(["c", "c"]);
    const session = makeSession(quiz, { q0: "a", q1: "b" });
    const result = scoreQuiz(session);
    expect(result).toEqual({ correct: 0, incorrect: 2, unanswered: 0, total: 2 });
  });

  it("scores unanswered as incorrect", () => {
    const quiz = makeQuiz(["c", "c"]);
    const session = makeSession(quiz, { q0: null, q1: null });
    const result = scoreQuiz(session);
    expect(result).toEqual({ correct: 0, incorrect: 0, unanswered: 2, total: 2 });
  });

  it("scores mixed answers", () => {
    const quiz = makeQuiz(["c", "c", "c"]);
    const session = makeSession(quiz, { q0: "c", q1: "a", q2: null });
    const result = scoreQuiz(session);
    expect(result).toEqual({ correct: 1, incorrect: 1, unanswered: 1, total: 3 });
  });

  it("normalizes case and whitespace", () => {
    const quiz = makeQuiz(["c"]);
    const session = makeSession(quiz, { q0: "  C  " });
    const result = scoreQuiz(session);
    expect(result.correct).toBe(1);
  });

  it("handles empty quiz", () => {
    const quiz: Quiz = { id: "q", questions: [], diagrams: {} };
    const session: QuizSession = {
      quiz,
      answers: {},
      config: {
        lives: { enabled: false, total: 3 },
        timePerQuestion: { enabled: false, durationMinutes: 2 },
        overallTime: { enabled: false, totalMinutes: 30 },
        generationMode: "generate",
      },
      status: "ended",
    };
    const result = scoreQuiz(session);
    expect(result).toEqual({ correct: 0, incorrect: 0, unanswered: 0, total: 0 });
  });
});
