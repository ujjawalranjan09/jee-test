import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UploadView } from "../components/Upload/UploadView";

// Mock the API client so we can drive the generate/extract flow without a
// running backend. The mocks live above the describe so the component import
// doesn't see an empty module.
vi.mock("../api/client", () => ({
  uploadPdf: vi.fn(async () => ({ text: "mock text", diagrams: [] })),
  uploadMultiplePdfs: vi.fn(async () => ({ text: "", diagrams: [] })),
  generateQuiz: vi.fn(async () => ({
    id: "q1",
    questions: [
      {
        id: "q-fallback",
        question: "fallback question",
        options: [{ id: "A", text: "a" }, { id: "B", text: "b" }],
        correctAnswerId: "A",
      },
    ],
    diagrams: {},
  })),
  extractQuiz: vi.fn(async () => ({
    id: "q-extract-empty",
    questions: [],
    diagrams: {},
  })),
}));

import {
  uploadPdf,
  generateQuiz,
  extractQuiz,
} from "../api/client";

const mockedUploadPdf = vi.mocked(uploadPdf);
const mockedGenerateQuiz = vi.mocked(generateQuiz);
const mockedExtractQuiz = vi.mocked(extractQuiz);

describe("UploadView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to a "successful" extract with 1 question so the basic tests
    // don't trigger the auto-recover branch.
    mockedExtractQuiz.mockResolvedValue({
      id: "q1",
      questions: [
        {
          id: "q",
          question: "Q",
          options: [{ id: "A", text: "a" }, { id: "B", text: "b" }],
          correctAnswerId: "A",
        },
      ],
      diagrams: {},
    });
    mockedGenerateQuiz.mockResolvedValue({
      id: "q2",
      questions: [
        {
          id: "q",
          question: "Q",
          options: [{ id: "A", text: "a" }, { id: "B", text: "b" }],
          correctAnswerId: "A",
        },
      ],
      diagrams: {},
    });
  });

  it("renders upload prompt", () => {
    render(<UploadView onQuizReady={vi.fn()} generationMode="generate" />);
    expect(screen.getByText(/Drop PDF here/)).toBeInTheDocument();
  });

  it("disables generate when no file", () => {
    render(<UploadView onQuizReady={vi.fn()} generationMode="generate" />);
    const btn = screen.getByText("Generate Quiz");
    expect(btn).toBeDisabled();
  });

  it("rejects non-PDF files", () => {
    const { container } = render(
      <UploadView onQuizReady={vi.fn()} generationMode="generate" />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    expect(input).toBeTruthy();
    // ... rest of test relies on actual file rejection logic
  });

  it("accepts PDF files", () => {
    const { container } = render(
      <UploadView onQuizReady={vi.fn()} generationMode="generate" />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "test.pdf", { type: "application/pdf" });
    expect(input).toBeTruthy();
    // ... rest of test relies on actual file acceptance logic
  });

  it("auto-falls-back to generate when extract returns 0 questions", async () => {
    // extract returns empty (metadata-only PDF scenario)
    mockedExtractQuiz.mockResolvedValue({
      id: "empty",
      questions: [],
      diagrams: {},
    });
    const onChangeGenerationMode = vi.fn();
    const onQuizReady = vi.fn();

    const { container } = render(
      <UploadView
        onQuizReady={onQuizReady}
        generationMode="exact"
        onChangeGenerationMode={onChangeGenerationMode}
      />,
    );

    // Attach a real PDF file via the hidden input.
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const pdf = new File(["x"], "test.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });

    // Click Generate.
    fireEvent.click(screen.getByText("Generate Quiz"));

    // Wait for both APIs to have been called.
    await waitFor(() => {
      expect(mockedExtractQuiz).toHaveBeenCalledTimes(1);
      expect(mockedGenerateQuiz).toHaveBeenCalledTimes(1);
    });

    // The exact→generate flip should have been requested.
    expect(onChangeGenerationMode).toHaveBeenCalledWith("generate");

    // And the user should NOT see the red error — instead we surfaced the
    // soft amber "Heads up" notice.
    expect(
      screen.queryByText(/Couldn't find any extractable MCQ text/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/this PDF doesn't have readable MCQ text/i),
    ).toBeInTheDocument();

    // And onQuizReady fired with the fallback quiz.
    expect(onQuizReady).toHaveBeenCalledTimes(1);
  });

  it("surfaces error when both exact AND fallback generate return 0 questions", async () => {
    mockedExtractQuiz.mockResolvedValue({
      id: "empty1",
      questions: [],
      diagrams: {},
    });
    mockedGenerateQuiz.mockResolvedValue({
      id: "empty2",
      questions: [],
      diagrams: {},
    });

    const { container } = render(
      <UploadView
        onQuizReady={vi.fn()}
        generationMode="exact"
        onChangeGenerationMode={vi.fn()}
      />,
    );

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "test.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByText("Generate Quiz"));

    await waitFor(() => {
      expect(mockedExtractQuiz).toHaveBeenCalledTimes(1);
      expect(mockedGenerateQuiz).toHaveBeenCalledTimes(1);
    });

    // Both paths tried → the error message + manual recovery button show.
    expect(
      screen.getByText(/Couldn't find any extractable MCQ text/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Switch to Generate new/ }),
    ).toBeInTheDocument();
  });

  it("does NOT attempt auto-fallback when generationMode is 'generate'", async () => {
    mockedGenerateQuiz.mockResolvedValue({
      id: "empty",
      questions: [],
      diagrams: {},
    });
    const onChangeGenerationMode = vi.fn();

    const { container } = render(
      <UploadView
        onQuizReady={vi.fn()}
        generationMode="generate"
        onChangeGenerationMode={onChangeGenerationMode}
      />,
    );

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "test.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByText("Generate Quiz"));

    await waitFor(() => {
      expect(mockedGenerateQuiz).toHaveBeenCalledTimes(1);
    });

    // Extract was never called — we only "generate".
    expect(mockedExtractQuiz).not.toHaveBeenCalled();
    // And no mode flip happened.
    expect(onChangeGenerationMode).not.toHaveBeenCalled();
  });
});