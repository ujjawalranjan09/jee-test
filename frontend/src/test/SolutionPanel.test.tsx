import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SolutionPanel,
  _clearSolveInflightForTests,
} from "../components/Review/SolutionPanel";
import type { Question, Diagram } from "../types";

// Mock the API client so we can drive the cross-check behavior
// without making real network calls. Each test sets the resolved
// shape to match what the backend would actually return.
vi.mock("../api/client", () => ({
  solveQuestion: vi.fn(),
}));

import { solveQuestion } from "../api/client";
const mockedSolve = vi.mocked(solveQuestion);

let idCounter = 0;
function makeQuestion(overrides: Partial<Question> = {}): Question {
  idCounter += 1;
  return {
    id: `q-test-${idCounter}`,
    prompt: "What is 2+2?",
    options: [
      { id: "A", text: "3" },
      { id: "B", text: "4" },
      { id: "C", text: "5" },
      { id: "D", text: "6" },
    ],
    correctAnswerId: "C", // quiz thinks C is correct
    diagramIds: [],
    topic: "Arithmetic",
    ...overrides,
  };
}

const noDiagrams: Record<string, Diagram> = {};

describe("SolutionPanel — answer cross-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the module-level inflight cache so prior tests don't leak.
    _clearSolveInflightForTests();
  });

  it("shows a mismatch warning when solver disagrees with quiz", async () => {
    // Solver computed B (correct), but quiz had C marked as the
    // correct answer. This is the bug from the screenshot.
    mockedSolve.mockResolvedValueOnce({
      solution: "Working it out... 2+2 = 4.\n\nAnswer: B",
      parsedAnswer: "B",
      originalAnswer: "C",
      answersMatch: false,
    });

    const user = userEvent.setup();
    render(
      <SolutionPanel question={makeQuestion()} diagramMap={noDiagrams} />,
    );

    await user.click(screen.getByRole("button", { name: /view solution/i }));

    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent(/possible wrong answer/i);
    // Original (wrong) letter is highlighted in red.
    expect(warning.textContent).toContain("C");
    // Solver-derived (correct) letter is highlighted in green.
    expect(warning.textContent).toContain("B");
    // The text should tell the student to trust the solver's work.
    expect(warning.textContent).toMatch(/trust.*working|solver/i);
  });

  it("does NOT show a mismatch warning when answers agree", async () => {
    mockedSolve.mockResolvedValueOnce({
      solution: "2+2 = 4. Answer: C",
      parsedAnswer: "C",
      originalAnswer: "C",
      answersMatch: true,
    });

    const user = userEvent.setup();
    render(
      <SolutionPanel question={makeQuestion()} diagramMap={noDiagrams} />,
    );
    await user.click(screen.getByRole("button", { name: /view solution/i }));

    // Wait for solution to appear, then check there's no alert.
    await screen.findByText(/2\+2 = 4/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does NOT show a mismatch warning when solver didn't emit an answer line", async () => {
    // Solver didn't end with "Answer: X" — we can't be sure if it
    // agrees or disagrees, so we silently render the solution.
    mockedSolve.mockResolvedValueOnce({
      solution: "Some rambling without an answer line.",
      parsedAnswer: null,
      originalAnswer: "C",
      answersMatch: null,
    });

    const user = userEvent.setup();
    render(
      <SolutionPanel question={makeQuestion()} diagramMap={noDiagrams} />,
    );
    await user.click(screen.getByRole("button", { name: /view solution/i }));

    await screen.findByText(/rambling/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("passes the original correctAnswerId to the backend solver", async () => {
    mockedSolve.mockResolvedValueOnce({
      solution: "...",
      parsedAnswer: "B",
      originalAnswer: "C",
      answersMatch: false,
    });

    const user = userEvent.setup();
    render(
      <SolutionPanel
        question={makeQuestion({ correctAnswerId: "C" })}
        diagramMap={noDiagrams}
      />,
    );
    await user.click(screen.getByRole("button", { name: /view solution/i }));

    await waitFor(() => expect(mockedSolve).toHaveBeenCalled());
    const callArgs = mockedSolve.mock.calls[0]!;
    // 5th positional arg is now a SolveOptions object (was a string in v2).
    const opts = callArgs[4] as { correctAnswerId?: string; questionType?: string };
    expect(opts.correctAnswerId).toBe("C");
    expect(opts.questionType).toBe("single");
  });

  it("sends undefined for correctAnswerId when the question doesn't have one", async () => {
    const qNoAnswer: Question = makeQuestion({ correctAnswerId: "" });
    mockedSolve.mockResolvedValueOnce({
      solution: "...",
      parsedAnswer: "B",
      originalAnswer: null,
      answersMatch: null,
    });

    const user = userEvent.setup();
    render(<SolutionPanel question={qNoAnswer} diagramMap={noDiagrams} />);
    await user.click(screen.getByRole("button", { name: /view solution/i }));

    await waitFor(() => expect(mockedSolve).toHaveBeenCalled());
    const opts = mockedSolve.mock.calls[0]![4] as { correctAnswerId?: string };
    expect(opts.correctAnswerId).toBeUndefined();
  });

  it("passes numericalAnswer + tolerance through for numerical questions", async () => {
    const qNum: Question = makeQuestion({
      // Override to a numerical question
      type: "numerical",
      options: [],
      correctAnswerId: "",
      correctAnswerIds: [],
      numericalAnswer: 25,
      numericalTolerance: 0.01,
    } as Partial<Question>);
    mockedSolve.mockResolvedValueOnce({
      solution: "25",
      parsedAnswer: "25",
      originalAnswer: "25",
      answersMatch: true,
    });
    const user = userEvent.setup();
    render(<SolutionPanel question={qNum} diagramMap={noDiagrams} />);
    await user.click(screen.getByRole("button", { name: /view solution/i }));
    await waitFor(() => expect(mockedSolve).toHaveBeenCalled());
    const opts = mockedSolve.mock.calls[0]![4] as {
      questionType?: string;
      numericalAnswer?: number | null;
      numericalTolerance?: number;
    };
    expect(opts.questionType).toBe("numerical");
    expect(opts.numericalAnswer).toBe(25);
    expect(opts.numericalTolerance).toBe(0.01);
  });

  it("renders the solution markdown when answers match", async () => {
    mockedSolve.mockResolvedValueOnce({
      solution: "Step 1: 2+2.\n\nAnswer: C",
      parsedAnswer: "C",
      originalAnswer: "C",
      answersMatch: true,
    });

    const user = userEvent.setup();
    render(
      <SolutionPanel question={makeQuestion()} diagramMap={noDiagrams} />,
    );
    await user.click(screen.getByRole("button", { name: /view solution/i }));

    // The solution text is rendered.
    expect(await screen.findByText(/2\+2/)).toBeInTheDocument();
  });
});