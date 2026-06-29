import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuizPlayer } from "../components/Quiz/QuizPlayer";
import type { QuizSession, AnswerState } from "../types";

const mockQuiz = {
  id: "quiz-1",
  questions: [
    {
      id: "q1",
      prompt: "What is 2 + 2?",
      options: [
        { id: "a", text: "3" },
        { id: "b", text: "4" },
        { id: "c", text: "5" },
      ],
      correctAnswerId: "b",
      diagramIds: [],
    },
    {
      id: "q2",
      prompt: "What is the capital of France?",
      options: [
        { id: "a", text: "London" },
        { id: "b", text: "Paris" },
        { id: "c", text: "Berlin" },
      ],
      correctAnswerId: "b",
      diagramIds: [],
    },
  ],
  diagrams: {},
};

const mockAnswers: Record<string, AnswerState> = {
  q1: { questionId: "q1", selectedOptionId: null, markedForReview: false },
  q2: { questionId: "q2", selectedOptionId: null, markedForReview: false },
};

const mockSession: QuizSession = {
  quiz: mockQuiz,
  answers: mockAnswers,
  config: {
    lives: { enabled: false, total: 3 },
    timePerQuestion: { enabled: false, durationMinutes: 2 },
    overallTime: { enabled: false, totalMinutes: 30 },
    generationMode: "generate",
  },
  status: "in_progress",
};

function getProps(overrides = {}) {
  return {
    session: mockSession,
    currentIdx: 0,
    answers: mockAnswers,
    timerRemaining: 0,
    timerEnabled: false,
    overallTimerRemaining: 0,
    overallTimerEnabled: false,
    livesTotal: 0,
    livesRemaining: 0,
    questionsAnswered: 0,
    getQuestionStatus: vi.fn().mockReturnValue("unanswered"),
    onSelectAnswer: vi.fn(),
    onToggleMark: vi.fn(),
    onGoTo: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe("QuizPlayer", () => {
  it("renders question prompt", () => {
    render(<QuizPlayer {...getProps()} />);
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
  });

  it("renders options", () => {
    render(<QuizPlayer {...getProps()} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows question number", () => {
    render(<QuizPlayer {...getProps()} />);
    // New design: counter lives in <span class="qp-topbar__counter">
    // with text "Q <strong>1</strong><span>/</span>2".
    const counter = document.querySelector(".qp-topbar__counter");
    expect(counter).not.toBeNull();
    expect(counter?.textContent?.trim()).toBe("Q 1/2");
  });

  it("disables prev on first question", () => {
    render(<QuizPlayer {...getProps()} />);
    expect(screen.getByRole("button", { name: /previous question/i })).toBeDisabled();
  });

  it("enables next when not on last question", () => {
    render(<QuizPlayer {...getProps()} />);
    expect(screen.getByRole("button", { name: /next question/i })).not.toBeDisabled();
  });

  it("calls onSelectAnswer when option clicked", async () => {
    const user = userEvent.setup();
    const onSelectAnswer = vi.fn();
    render(<QuizPlayer {...getProps({ onSelectAnswer })} />);

    await user.click(screen.getByText("4"));
    expect(onSelectAnswer).toHaveBeenCalledWith("q1", "b");
  });

  it("calls onNext when next clicked", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<QuizPlayer {...getProps({ onNext })} />);

    await user.click(screen.getByRole("button", { name: /next question/i }));
    expect(onNext).toHaveBeenCalled();
  });

  it("calls onToggleMark when mark button clicked", async () => {
    const user = userEvent.setup();
    const onToggleMark = vi.fn();
    render(<QuizPlayer {...getProps({ onToggleMark })} />);

    // New design: aria-label is "Mark for review"
    await user.click(screen.getByRole("button", { name: /mark for review/i }));
    expect(onToggleMark).toHaveBeenCalledWith("q1");
  });

  it("shows palette toggle button", () => {
    render(<QuizPlayer {...getProps()} />);
    // New design: aria-label includes "Open question palette"
    expect(
      screen.getByRole("button", { name: /open question palette/i }),
    ).toBeInTheDocument();
  });

  it("shows submit button on last question", () => {
    render(<QuizPlayer {...getProps({ currentIdx: 1 })} />);
    // New design: when on the last question the bottom-nav primary button
    // is labelled "Submit" (no "Quiz" suffix).
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
  });

  it("shows correct progress counter", () => {
    render(<QuizPlayer {...getProps()} />);
    // "0/2 answered" lives inside the menu button's aria-label
    expect(
      screen.getByRole("button", { name: /open question palette \(0 of 2 answered\)/i }),
    ).toBeInTheDocument();
  });
});