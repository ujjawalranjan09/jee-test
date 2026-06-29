import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreView } from "../components/Score/ScoreView";
import type { QuizSession } from "../types";

function makeSession(total: number): QuizSession {
  const questions = Array.from({ length: total }, (_, i) => ({
    id: `q${i}`,
    prompt: `Question ${i}`,
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    correctAnswerId: "a",
    diagramIds: [],
  }));
  const answers: QuizSession["answers"] = {};
  for (const q of questions) {
    answers[q.id] = {
      questionId: q.id,
      selectedOptionId: null,
      markedForReview: false,
    };
  }
  return {
    quiz: { id: "quiz1", questions, diagrams: {} },
    answers,
    config: {
      lives: { enabled: false, total: 3 },
      timePerQuestion: { enabled: false, durationMinutes: 2 },
      overallTime: { enabled: false, totalMinutes: 30 },
      generationMode: "generate",
    },
    status: "ended",
  };
}

describe("ScoreView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders quiz complete heading", () => {
    render(
      <ScoreView
        score={{ correct: 8, incorrect: 1, unanswered: 1, total: 10 }}
        session={makeSession(10)}
        onReview={vi.fn()}
        onNewQuiz={vi.fn()}
      />,
    );
    expect(screen.getByText("Quiz Complete")).toBeInTheDocument();
  });

  it("shows percentage", () => {
    render(
      <ScoreView
        score={{ correct: 7, incorrect: 2, unanswered: 1, total: 10 }}
        session={makeSession(10)}
        onReview={vi.fn()}
        onNewQuiz={vi.fn()}
      />,
    );
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("shows correct/incorrect/unanswered counts", () => {
    render(
      <ScoreView
        score={{ correct: 5, incorrect: 3, unanswered: 2, total: 10 }}
        session={makeSession(10)}
        onReview={vi.fn()}
        onNewQuiz={vi.fn()}
      />,
    );
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows grade text", () => {
    render(
      <ScoreView
        score={{ correct: 9, incorrect: 1, unanswered: 0, total: 10 }}
        session={makeSession(10)}
        onReview={vi.fn()}
        onNewQuiz={vi.fn()}
      />,
    );
    expect(screen.getByText("Excellent!")).toBeInTheDocument();
  });

  it("calls onReview when review button clicked", async () => {
    const onReview = vi.fn();
    render(
      <ScoreView
        score={{ correct: 5, incorrect: 5, unanswered: 0, total: 10 }}
        session={makeSession(10)}
        onReview={onReview}
        onNewQuiz={vi.fn()}
      />,
    );

    screen.getByText("Review Answers").click();
    expect(onReview).toHaveBeenCalled();
  });

  it("calls onNewQuiz when new quiz button clicked", async () => {
    const onNewQuiz = vi.fn();
    render(
      <ScoreView
        score={{ correct: 5, incorrect: 5, unanswered: 0, total: 10 }}
        session={makeSession(10)}
        onReview={vi.fn()}
        onNewQuiz={onNewQuiz}
      />,
    );

    screen.getByText("New Quiz").click();
    expect(onNewQuiz).toHaveBeenCalled();
  });
});
