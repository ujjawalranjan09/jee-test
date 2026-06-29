import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewView } from "../components/Review/ReviewView";
import type { QuizSession } from "../types";

const mockQuiz = {
  id: "quiz-1",
  questions: [
    {
      id: "q1",
      prompt: "What is 2+2?",
      options: [
        { id: "a", text: "3" },
        { id: "b", text: "4" },
      ],
      correctAnswerId: "b",
      diagramIds: [],
    },
    {
      id: "q2",
      prompt: "Capital of France?",
      options: [
        { id: "a", text: "London" },
        { id: "b", text: "Paris" },
      ],
      correctAnswerId: "b",
      diagramIds: [],
    },
  ],
  diagrams: {},
};

const mockSession: QuizSession = {
  quiz: mockQuiz,
  answers: {
    q1: { questionId: "q1", selectedOptionId: "b", markedForReview: false },
    q2: { questionId: "q2", selectedOptionId: "a", markedForReview: false },
  },
  config: {
    lives: { enabled: false, total: 3 },
    timePerQuestion: { enabled: false, durationMinutes: 2 },
    overallTime: { enabled: false, totalMinutes: 30 },
    generationMode: "generate",
  },
  status: "ended",
};

describe("ReviewView", () => {
  it("renders review title", () => {
    render(<ReviewView session={mockSession} onNewQuiz={vi.fn()} />);
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("shows all questions", () => {
    render(<ReviewView session={mockSession} onNewQuiz={vi.fn()} />);
    expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    expect(screen.getByText("Capital of France?")).toBeInTheDocument();
  });

  it("shows correct/incorrect indicators", () => {
    render(<ReviewView session={mockSession} onNewQuiz={vi.fn()} />);
    // q1 correct, q2 incorrect
    const checkmarks = screen.getAllByText("✓");
    const crosses = screen.getAllByText("✗");
    expect(checkmarks.length).toBeGreaterThanOrEqual(1);
    expect(crosses.length).toBeGreaterThanOrEqual(1);
  });

  it("expands question details on click", async () => {
    const user = userEvent.setup();
    render(<ReviewView session={mockSession} onNewQuiz={vi.fn()} />);

    // Click the second question header (starts collapsed)
    const q2Header = screen.getByText("Capital of France?").closest("button")!;
    await user.click(q2Header);

    // Should show option details with badges
    expect(screen.getByText("Your answer")).toBeInTheDocument();
    expect(screen.getByText("Correct")).toBeInTheDocument();
  });

  it("calls onNewQuiz", () => {
    const onNewQuiz = vi.fn();
    render(<ReviewView session={mockSession} onNewQuiz={onNewQuiz} />);
    screen.getByText("New Quiz").click();
    expect(onNewQuiz).toHaveBeenCalled();
  });
});
