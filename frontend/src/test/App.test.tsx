import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../App";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ status: "ok" }),
  });
});

describe("App", () => {
  it("renders the app header", () => {
    render(<App />);
    const headers = screen.getAllByText("QuizForge");
    expect(headers.length).toBeGreaterThanOrEqual(1);
  });

  it("does not render an API key manager (keys are server-side)", () => {
    render(<App />);
    expect(screen.queryByText("API Keys")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste your Gemini API key/i)).not.toBeInTheDocument();
  });

  it("renders the new QuizOptions panel on setup view (replaces old Challenge Mode radios)", () => {
    render(<App />);
    expect(screen.getByText("Quiz Options")).toBeInTheDocument();
    expect(screen.getByText("Lives")).toBeInTheDocument();
    expect(screen.getByText("Time per question")).toBeInTheDocument();
    expect(screen.getByText("Total quiz time")).toBeInTheDocument();
    expect(screen.getByText("Question source")).toBeInTheDocument();
  });

  it("does NOT render the old Challenge Mode radios", () => {
    render(<App />);
    expect(screen.queryByText("Speed Round")).not.toBeInTheDocument();
    expect(screen.queryByText("Survival")).not.toBeInTheDocument();
    expect(screen.queryByText("Marathon")).not.toBeInTheDocument();
  });

  it("Question source defaults to 'Generate new'", () => {
    render(<App />);
    expect(screen.getByRole("radio", { name: /Generate new/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Exact from PDF/i })).not.toBeChecked();
  });

  it("fires health check on mount", () => {
    render(<App />);
    expect(mockFetch).toHaveBeenCalledWith("/api/health", expect.anything());
  });
});
