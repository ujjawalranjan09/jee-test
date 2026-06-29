import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PwaInstallPrompt } from "../components/PwaInstallPrompt";

const STORAGE_KEY = "qf_pwa_install_dismissed_v1";

describe("PwaInstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("does NOT render when no beforeinstallprompt event has fired", () => {
    render(<PwaInstallPrompt />);
    // No install UI present.
    expect(screen.queryByText("Install QuizForge")).toBeNull();
    expect(screen.queryByText("Add to Home Screen")).toBeNull();
  });

  it("renders the Android install toast when beforeinstallprompt fires", async () => {
    render(<PwaInstallPrompt />);
    const event = new Event("beforeinstallprompt");
    // The component reads these in its handler:
    Object.assign(event, {
      platforms: ["web"],
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
      prompt: vi.fn().mockResolvedValue(undefined),
    });
    window.dispatchEvent(event);

    await waitFor(() =>
      expect(screen.getByText("Install QuizForge")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Add to your home screen for full-screen quizzes/),
    ).toBeInTheDocument();
  });

  it("calls prompt() when the user taps Install", async () => {
    render(<PwaInstallPrompt />);
    const promptMock = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      platforms: ["web"],
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      prompt: promptMock,
    });
    window.dispatchEvent(event);

    const installBtn = await screen.findByRole("button", { name: "Install" });
    fireEvent.click(installBtn);

    await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1));
  });

  it("dismisses the toast and remembers the dismissal for 7 days", async () => {
    render(<PwaInstallPrompt />);
    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      platforms: ["web"],
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
      prompt: vi.fn(),
    });
    window.dispatchEvent(event);

    const close = await screen.findByLabelText("Dismiss install prompt");
    fireEvent.click(close);

    await waitFor(() =>
      expect(screen.queryByText("Install QuizForge")).toBeNull(),
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it("respects a recent dismissal — does NOT show the toast again", async () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now())); // dismissed right now
    render(<PwaInstallPrompt />);

    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      platforms: ["web"],
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
      prompt: vi.fn(),
    });
    window.dispatchEvent(event);

    // Wait a tick for React to render if it were going to.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Install QuizForge")).toBeNull();
  });

  it("renders iOS share-sheet hint for iOS user-agent (no beforeinstallprompt needed)", () => {
    const originalUA = window.navigator.userAgent;
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    try {
      render(<PwaInstallPrompt />);
      const matches = screen.getAllByText("Add to Home Screen");
      expect(matches.length).toBeGreaterThan(0);
      // The hint mentions the iOS share gesture.
      expect(screen.getByText(/Share/)).toBeInTheDocument();
    } finally {
      Object.defineProperty(window.navigator, "userAgent", {
        value: originalUA,
        configurable: true,
      });
    }
  });
});