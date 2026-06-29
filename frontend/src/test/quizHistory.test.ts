import { describe, it, expect, beforeEach } from "vitest";
import { saveQuizResult, getQuizHistory, clearHistory, type QuizHistoryEntry } from "../utils/quizHistory";

function makeEntry(overrides: Partial<QuizHistoryEntry> = {}): QuizHistoryEntry {
  return {
    id: "test-1",
    date: new Date().toISOString(),
    quizTitle: "Test Quiz",
    totalQuestions: 10,
    correct: 7,
    incorrect: 2,
    unanswered: 1,
    percentage: 70,
    timeTaken: 300,
    topics: { Math: { correct: 4, total: 5 }, Science: { correct: 3, total: 5 } },
    difficulty: "mixed",
    ...overrides,
  };
}

describe("quizHistory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty array when no history", () => {
    expect(getQuizHistory()).toEqual([]);
  });

  it("saves and retrieves quiz results", () => {
    const entry = makeEntry();
    saveQuizResult(entry);
    const history = getQuizHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.id).toBe("test-1");
    expect(history[0]!.percentage).toBe(70);
  });

  it("prepends new entries (newest first)", () => {
    saveQuizResult(makeEntry({ id: "first" }));
    saveQuizResult(makeEntry({ id: "second" }));
    const history = getQuizHistory();
    expect(history[0]!.id).toBe("second");
    expect(history[1]!.id).toBe("first");
  });

  it("limits to 100 entries", () => {
    for (let i = 0; i < 110; i++) {
      saveQuizResult(makeEntry({ id: `entry-${i}` }));
    }
    expect(getQuizHistory()).toHaveLength(100);
  });

  it("clears history", () => {
    saveQuizResult(makeEntry());
    clearHistory();
    expect(getQuizHistory()).toEqual([]);
  });
});
