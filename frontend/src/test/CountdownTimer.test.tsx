import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountdownTimer } from "../components/Quiz/CountdownTimer";

describe("CountdownTimer", () => {
  it("renders nothing when seconds is exactly 0 (transient state, not shown)", () => {
    const { container } = render(<CountdownTimer remainingSeconds={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders normal mm:ss format when positive", () => {
    render(<CountdownTimer remainingSeconds={125} />);
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("05")).toBeInTheDocument();
  });

  it("renders hours when >= 3600s", () => {
    render(<CountdownTimer remainingSeconds={3661} />);
    const timer = screen.getByRole("timer");
    expect(timer).toHaveTextContent("01:01:01");
  });

  it("has timer role and aria-live", () => {
    render(<CountdownTimer remainingSeconds={60} />);
    const timer = screen.getByRole("timer");
    expect(timer).toHaveAttribute("aria-live", "polite");
  });

  it("applies low class when remaining in 60..300s", () => {
    render(<CountdownTimer remainingSeconds={299} />);
    const timer = screen.getByRole("timer");
    expect(timer.className).toContain("low");
  });

  it("applies critical class when remaining in 1..60s", () => {
    render(<CountdownTimer remainingSeconds={45} />);
    const timer = screen.getByRole("timer");
    expect(timer.className).toContain("critical");
  });

  // ── NEW: negative / overtime behaviour ──────────────────────────────────
  it("renders absolute time + overtime class when seconds is negative", () => {
    render(<CountdownTimer remainingSeconds={-15} />);
    const timer = screen.getByRole("timer");
    // Should still be in DOM (not hidden), with the red overtime style.
    expect(timer.className).toContain("overtime");
    expect(timer).toHaveTextContent("00:15");
  });

  it("uses assertive aria-live in overtime", () => {
    render(<CountdownTimer remainingSeconds={-1} />);
    const timer = screen.getByRole("timer");
    expect(timer).toHaveAttribute("aria-live", "assertive");
  });

  it("formats larger negative values into minutes too", () => {
    render(<CountdownTimer remainingSeconds={-75} />);
    const timer = screen.getByRole("timer");
    expect(timer.className).toContain("overtime");
    expect(timer).toHaveTextContent("01:15");
  });
});
