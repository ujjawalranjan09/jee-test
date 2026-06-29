import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QuestionPalette } from "../components/Quiz/QuestionPalette";

const questionIds = ["q1", "q2", "q3"];

function getProps(overrides = {}) {
  return {
    total: 3,
    currentIdx: 0,
    getStatus: vi.fn().mockReturnValue("unanswered"),
    questionIds,
    onSelect: vi.fn(),
    open: false,
    onClose: vi.fn(),
    ...overrides,
  };
}

/** Get the palette drawer (it's a dialog in the new design). */
function getDrawer() {
  return screen.getByRole("dialog", { name: "Question palette" });
}

describe("QuestionPalette", () => {
  it("renders all question numbers in the grid", () => {
    render(<QuestionPalette {...getProps()} />);
    const drawer = getDrawer();
    const buttons = within(drawer).getAllByRole("button");
    const nums = buttons.map((b) => b.textContent);
    expect(nums).toContain("1");
    expect(nums).toContain("2");
    expect(nums).toContain("3");
  });

  it("marks current question", () => {
    render(<QuestionPalette {...getProps({ currentIdx: 1 })} />);
    const drawer = getDrawer();
    const current = within(drawer).getByText("2");
    expect(current).toHaveAttribute("aria-current", "step");
  });

  it("applies correct status class for answered", () => {
    const getStatus = vi.fn().mockReturnValue("answered");
    render(<QuestionPalette {...getProps({ getStatus })} />);
    const drawer = getDrawer();
    const btn = within(drawer).getByText("1");
    expect(btn.className).toContain("answered");
  });

  it("applies correct status class for marked", () => {
    const getStatus = vi.fn().mockReturnValue("markedForReview");
    render(<QuestionPalette {...getProps({ getStatus })} />);
    const drawer = getDrawer();
    const btn = within(drawer).getByText("1");
    expect(btn.className).toContain("marked");
  });

  it("has accessible labels", () => {
    render(<QuestionPalette {...getProps()} />);
    const drawer = getDrawer();
    expect(
      within(drawer).getByLabelText(
        "Question 1. Unanswered. Current question.",
      ),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByLabelText("Question 2. Unanswered"),
    ).toBeInTheDocument();
  });

  it("is hidden by default", () => {
    render(<QuestionPalette {...getProps({ open: false })} />);
    expect(getDrawer()).not.toHaveClass("palette-drawer--open");
  });

  it("opens when open=true", () => {
    render(<QuestionPalette {...getProps({ open: true })} />);
    expect(getDrawer()).toHaveClass("palette-drawer--open");
  });

  it("shows answered count in subtitle", () => {
    const getStatus = vi.fn((id: string) =>
      id === "q1" ? "answered" : "unanswered",
    );
    render(<QuestionPalette {...getProps({ getStatus, open: true })} />);
    expect(screen.getByText(/1 of 3 answered/)).toBeInTheDocument();
  });
});