import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia. Several components (PwaInstallPrompt,
// the theme detector) rely on it. Install a no-op stub that always reports
// "not standalone". Tests can override this per-case.
if (typeof window !== "undefined") {
  type Mql = {
    matches: boolean;
    media: string;
    onchange: null;
    addListener: () => void;
    removeListener: () => void;
    addEventListener: () => void;
    removeEventListener: () => void;
    dispatchEvent: () => boolean;
  };
  const stub = (query: string): Mql => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  try {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: stub,
    });
  } catch {
    /* already defined non-configurably — leave whatever jsdom provided */
  }
}