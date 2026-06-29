import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuizOptions } from "../components/Quiz/QuizOptions";
import type { QuizConfig } from "../types";

const BASE: QuizConfig = {
  lives: { enabled: false, total: 3 },
  timePerQuestion: { enabled: false, durationMinutes: 2 },
  overallTime: { enabled: false, totalMinutes: 30 },
  generationMode: "generate",
};

describe("QuizOptions — independent toggles (replaces Challenge Mode radio)", () => {
  it("renders both toggle rows", () => {
    render(<QuizOptions config={BASE} onChange={vi.fn()} />);
    expect(screen.getByText("Lives")).toBeInTheDocument();
    expect(screen.getByText("Time per question")).toBeInTheDocument();
  });

  it("does NOT render the old Challenge Mode radios", () => {
    render(<QuizOptions config={BASE} onChange={vi.fn()} />);
    expect(screen.queryByText("Speed Round")).not.toBeInTheDocument();
    expect(screen.queryByText("Survival")).not.toBeInTheDocument();
    expect(screen.queryByText("Marathon")).not.toBeInTheDocument();
  });

  it("hides customization controls when both toggles are off", () => {
    render(<QuizOptions config={BASE} onChange={vi.fn()} />);
    expect(screen.queryByText("Starting lives")).not.toBeInTheDocument();
    expect(screen.queryByText("Minutes per question")).not.toBeInTheDocument();
  });

  it("can enable Lives WITHOUT enabling Time per question", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuizOptions config={BASE} onChange={onChange} />);
    const livesCheckbox = screen.getAllByRole("checkbox")[0]!; // first toggle = Lives
    await user.click(livesCheckbox);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        lives: expect.objectContaining({ enabled: true }),
        timePerQuestion: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("can enable Time per question WITHOUT enabling Lives", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuizOptions config={BASE} onChange={onChange} />);
    const timeCheckbox = screen.getAllByRole("checkbox")[1]!; // second toggle = Time
    await user.click(timeCheckbox);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        lives: expect.objectContaining({ enabled: false }),
        timePerQuestion: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it("can enable BOTH Lives AND Time per question (independent toggles)", () => {
    const onChange = vi.fn();
    const both: QuizConfig = {
      ...BASE,
      lives: { enabled: true, total: 5 },
      timePerQuestion: { enabled: true, durationMinutes: 3 },
    };
    render(<QuizOptions config={both} onChange={onChange} />);
    // Both toggles should be checked.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    // And the combo summary should be visible.
    expect(
      screen.getByText(/5 lives.*3 min per question/i),
    ).toBeInTheDocument();
  });

  it("shows the customizable life-count chips when Lives is enabled", () => {
    render(
      <QuizOptions
        config={{ ...BASE, lives: { enabled: true, total: 3 } }}
        onChange={vi.fn()}
      />,
    );
    // Chip buttons for 1, 2, 3, 5, 7, 10 — and the custom-input.
    expect(screen.getByRole("button", { name: /^3 lives$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^5 lives$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^7 lives$/ })).toBeInTheDocument();
  });

  it("changing the life chip fires onChange with the new count", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <QuizOptions
        config={{ ...BASE, lives: { enabled: true, total: 3 } }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^7 lives$/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        lives: { enabled: true, total: 7 },
      }),
    );
  });

  it("shows time-per-question chip picker restricted to 1,2,3,4,5,6 minutes", () => {
    render(
      <QuizOptions
        config={{ ...BASE, timePerQuestion: { enabled: true, durationMinutes: 2 } }}
        onChange={vi.fn()}
      />,
    );
    for (const m of [1, 2, 3, 4, 5, 6]) {
      expect(
        screen.getByRole("radio", {
          name: new RegExp(`^${m} min(ute)?s? per question$`, "i"),
        }),
      ).toBeInTheDocument();
    }
  });

  it("selecting a different minute value fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <QuizOptions
        config={{ ...BASE, timePerQuestion: { enabled: true, durationMinutes: 2 } }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("radio", { name: /^4 minutes per question$/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        timePerQuestion: { enabled: true, durationMinutes: 4 },
      }),
    );
  });

  it("custom life input accepts a value and fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <QuizOptions
        config={{ ...BASE, lives: { enabled: true, total: 3 } }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Custom life count");
    await user.clear(input);
    await user.type(input, "9");
    // Last call should include total=9.
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as QuizConfig;
    expect(last.lives.total).toBe(9);
  });

  // ── OVERALL QUIZ TIME (new) ──────────────────────────────────────────
  it("shows the overall-time section with a typable input + preset chips", () => {
    render(
      <QuizOptions
        config={{ ...BASE, overallTime: { enabled: true, totalMinutes: 30 } }}
        onChange={vi.fn()}
      />,
    );
    // Typable input — user can type any 1–999.
    expect(screen.getByLabelText("Total quiz minutes")).toBeInTheDocument();
    // Quick-pick chips for common values.
    expect(screen.getByRole("button", { name: /^5 minutes$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^30 minutes$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^90 minutes$/ })).toBeInTheDocument();
  });

  it("typing a custom minute value fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <QuizOptions
        config={{ ...BASE, overallTime: { enabled: true, totalMinutes: 30 } }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Total quiz minutes");
    await user.clear(input);
    await user.type(input, "75");
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as QuizConfig;
    expect(last.overallTime.totalMinutes).toBe(75);
  });

  it("rejects an overall-time value below 1 minute", async () => {
    const user = userEvent.setup();
    render(
      <QuizOptions
        config={{ ...BASE, overallTime: { enabled: true, totalMinutes: 30 } }}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Total quiz minutes");
    await user.clear(input);
    await user.type(input, "0");
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 1/i);
  });

  it("clicking a preset chip fires onChange with that value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <QuizOptions
        config={{ ...BASE, overallTime: { enabled: true, totalMinutes: 30 } }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^45 minutes$/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        overallTime: { enabled: true, totalMinutes: 45 },
      }),
    );
  });

  // ── QUESTION SOURCE (new) ───────────────────────────────────────────
  it("renders the Question source radio", () => {
    render(<QuizOptions config={BASE} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Exact from PDF/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Generate new/i })).toBeInTheDocument();
  });

  it("selects 'generate' by default", () => {
    render(<QuizOptions config={BASE} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Generate new/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Exact from PDF/i })).not.toBeChecked();
  });

  it("clicking 'Exact from PDF' fires onChange with generationMode='exact'", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuizOptions config={BASE} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: /Exact from PDF/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ generationMode: "exact" }),
    );
  });
});
