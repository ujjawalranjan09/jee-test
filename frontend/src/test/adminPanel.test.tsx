/**
 * Tests for the AdminPanel component — verify the panel renders, calls the
 * right admin endpoints, and surfaces success/error feedback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminPanel } from "../components/Admin/AdminPanel";

// Mock the API client module so the test doesn't make real network calls.
vi.mock("../api/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAdminOverview: vi.fn(),
    updateAdminKey: vi.fn(),
    switchAdminProvider: vi.fn(),
    testAdminKey: vi.fn(),
  };
});

import {
  getAdminOverview,
  updateAdminKey,
  switchAdminProvider,
  testAdminKey,
} from "../api/client";

const mockedOverview = vi.mocked(getAdminOverview);
const mockedUpdate = vi.mocked(updateAdminKey);
const mockedSwitch = vi.mocked(switchAdminProvider);
const mockedTest = vi.mocked(testAdminKey);

const fakeOverview = {
  active_provider: "minimax",
  gemini: {
    provider: "gemini",
    masked_key: "AIza...wxyz",
    raw_value: "AIzaSy_old_gemini_key",
    source: "env",
    key_count: 1,
  },
  minimax: {
    provider: "minimax",
    masked_key: "sk-m...abcd",
    raw_value: "sk-mimo-old-key",
    source: "env",
    key_count: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminPanel — overview + save flow", () => {
  it("renders the masked current keys for both providers on load", async () => {
    mockedOverview.mockResolvedValueOnce(fakeOverview);

    render(<AdminPanel onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("AIza...wxyz")).toBeInTheDocument();
      expect(screen.getByText("sk-m...abcd")).toBeInTheDocument();
    });

    // Active provider badge
    expect(screen.getByText(/Active provider:/)).toBeInTheDocument();
    // "active" status appears for the active provider card
    expect(screen.getAllByText(/active/i).length).toBeGreaterThan(0);
  });

  it("Save & use calls updateAdminKey with the pasted value", async () => {
    mockedOverview.mockResolvedValueOnce(fakeOverview);
    mockedUpdate.mockResolvedValueOnce({
      ok: true,
      provider: "minimax",
      masked_key: "sk-n...NEW0",
    });
    mockedOverview.mockResolvedValueOnce({
      ...fakeOverview,
      minimax: { ...fakeOverview.minimax, masked_key: "sk-n...NEW0" },
    });

    render(<AdminPanel onBack={() => {}} />);
    const user = userEvent.setup();

    // Find the minimax input (the one with placeholder mentioning MiniMax).
    const minimaxInput = await screen.findByPlaceholderText(/Paste new MiniMax/i);
    await user.type(minimaxInput, "sk-new-mimo-key");

    // Click the matching "Save & use" button.
    const saveButtons = screen.getAllByRole("button", { name: /Save & use/i });
    const minimaxSaveBtn = saveButtons.find((b) =>
      b.closest(".admin-panel__card")?.contains(minimaxInput),
    );
    expect(minimaxSaveBtn).toBeDefined();
    fireEvent.click(minimaxSaveBtn!);

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("minimax", "sk-new-mimo-key");
    });

    // Feedback message confirms the save.
    expect(
      await screen.findByText(/MiniMax.*key saved/i),
    ).toBeInTheDocument();
  });

  it("Test button calls testAdminKey with the current draft and shows feedback", async () => {
    mockedOverview.mockResolvedValueOnce(fakeOverview);
    mockedTest.mockResolvedValueOnce({
      ok: true,
      provider: "gemini",
      message: "Key works.",
    });

    render(<AdminPanel onBack={() => {}} />);
    const user = userEvent.setup();

    const geminiInput = await screen.findByPlaceholderText(/Paste new Gemini/i);
    await user.type(geminiInput, "AIzaSyTestKey");

    const testButtons = screen.getAllByRole("button", { name: /^Test$/ });
    const geminiTestBtn = testButtons.find((b) =>
      b.closest(".admin-panel__card")?.contains(geminiInput),
    );
    fireEvent.click(geminiTestBtn!);

    await waitFor(() => {
      expect(mockedTest).toHaveBeenCalledWith("gemini", "AIzaSyTestKey");
    });
    expect(
      await screen.findByText(/Key works/i),
    ).toBeInTheDocument();
  });

  it("shows the error message when Save fails", async () => {
    mockedOverview.mockResolvedValueOnce(fakeOverview);
    mockedUpdate.mockRejectedValueOnce(new Error("network down"));

    render(<AdminPanel onBack={() => {}} />);
    const user = userEvent.setup();

    const geminiInput = await screen.findByPlaceholderText(/Paste new Gemini/i);
    await user.type(geminiInput, "AIzaSyBad");

    const saveButtons = screen.getAllByRole("button", { name: /Save & use/i });
    const geminiSaveBtn = saveButtons.find((b) =>
      b.closest(".admin-panel__card")?.contains(geminiInput),
    );
    fireEvent.click(geminiSaveBtn!);

    expect(
      await screen.findByText(/Save failed: network down/i),
    ).toBeInTheDocument();
  });

  it("does not allow Save when the input is empty", async () => {
    mockedOverview.mockResolvedValueOnce(fakeOverview);

    render(<AdminPanel onBack={() => {}} />);

    const saveButtons = await screen.findAllByRole("button", {
      name: /Save & use/i,
    });
    // All save buttons disabled because their inputs are empty.
    saveButtons.forEach((b) => expect(b).toBeDisabled());
  });

  it("clicking the inactive provider triggers switchAdminProvider", async () => {
    mockedOverview.mockResolvedValueOnce(fakeOverview);
    mockedSwitch.mockResolvedValueOnce({
      ok: true,
      provider: "gemini",
      masked_key: "",
    });
    mockedOverview.mockResolvedValueOnce({
      ...fakeOverview,
      active_provider: "gemini",
    });

    render(<AdminPanel onBack={() => {}} />);
    await screen.findByText("AIza...wxyz");

    // The "Gemini" provider button is inactive (current is minimax).
    const geminiProviderBtn = screen.getByRole("button", { name: /Gemini/i });
    fireEvent.click(geminiProviderBtn);

    await waitFor(() => {
      expect(mockedSwitch).toHaveBeenCalledWith("gemini");
    });
    expect(
      await screen.findByText(/Switched to Gemini/i),
    ).toBeInTheDocument();
  });

  it("pressing Enter inside an input triggers Save", async () => {
    mockedOverview.mockResolvedValueOnce(fakeOverview);
    mockedUpdate.mockResolvedValueOnce({
      ok: true,
      provider: "minimax",
      masked_key: "sk-m...ENTR",
    });
    mockedOverview.mockResolvedValueOnce(fakeOverview);

    render(<AdminPanel onBack={() => {}} />);
    const user = userEvent.setup();

    const input = await screen.findByPlaceholderText(/Paste new MiniMax/i);
    await user.type(input, "sk-mimo-enter{Enter}");

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith("minimax", "sk-mimo-enter");
    });
  });

  it("renders a load error if getAdminOverview rejects", async () => {
    mockedOverview.mockRejectedValueOnce(new Error("503 Service Unavailable"));

    render(<AdminPanel onBack={() => {}} />);

    expect(
      await screen.findByText(/Could not reach backend/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/503 Service Unavailable/)).toBeInTheDocument();
  });

  it("calls onBack when the Back button is clicked", async () => {
    mockedOverview.mockResolvedValueOnce(fakeOverview);
    const onBack = vi.fn();

    render(<AdminPanel onBack={onBack} />);
    const backBtn = await screen.findByRole("button", { name: /Back/i });
    fireEvent.click(backBtn);

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});