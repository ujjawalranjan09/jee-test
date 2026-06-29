/**
 * Regression tests for the updateConfig merge bug.
 *
 * Bug: `updateConfig` used to REPLACE the config with whatever was passed
 * in. Callers that passed a partial object (e.g. `{ generationMode: "exact" }`)
 * would silently drop `lives`, `timePerQuestion`, and `overallTime`. When
 * the user then started a quiz, App.tsx would read `.enabled` on the
 * missing sub-objects and crash with "Cannot read properties of undefined
 * (reading 'enabled')".
 *
 * Fix: `updateConfig` now merges a patch onto the existing state, so any
 * nested sub-object that isn't being updated is preserved.
 *
 * Repro path in production:
 *   1. User picks "Exact from PDF" + Uploads PDF
 *   2. /quiz/extract returns 0 questions
 *   3. UploadView triggers auto-recovery:
 *      onChangeGenerationMode("generate")
 *      → App.tsx: session.updateConfig({ generationMode: "generate" })
 *      → previously nuked the entire config
 *   4. UploadView calls onQuizReady(quiz) with the freshly-generated quiz
 *   5. App.tsx: session.startSession(quiz, session.config)
 *      → stores the partial config in the session
 *   6. App.tsx renders <QuizPlayer> and reads .timePerQuestion.enabled
 *      → CRASH
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQuizSession } from "../hooks/useQuizSession";

const CONFIG_KEY = "qf_quiz_config";

beforeEach(() => {
  sessionStorage.clear();
  // Pre-load a config so the hook picks up known defaults to mutate
  sessionStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({
      lives: { enabled: false, total: 3 },
      timePerQuestion: { enabled: true, durationMinutes: 4 },
      overallTime: { enabled: false, totalMinutes: 30 },
      generationMode: "generate",
    }),
  );
});

describe("useQuizSession — updateConfig merge behaviour", () => {
  it("preserves lives, timePerQuestion, and overallTime when only generationMode is patched", () => {
    const { result } = renderHook(() => useQuizSession());

    // Sanity: the loaded config has a real timePerQuestion sub-object
    expect(result.current.config.timePerQuestion).toEqual({
      enabled: true,
      durationMinutes: 4,
    });
    expect(result.current.config.lives).toEqual({
      enabled: false,
      total: 3,
    });
    expect(result.current.config.overallTime).toEqual({
      enabled: false,
      totalMinutes: 30,
    });

    act(() => {
      // Same patch App.tsx sends when the user toggles "Exact from PDF"
      result.current.updateConfig({ generationMode: "exact" });
    });

    // The patch was applied
    expect(result.current.config.generationMode).toBe("exact");
    // And ALL the other fields are still intact — this is what used to fail
    expect(result.current.config.timePerQuestion).toEqual({
      enabled: true,
      durationMinutes: 4,
    });
    expect(result.current.config.lives).toEqual({
      enabled: false,
      total: 3,
    });
    expect(result.current.config.overallTime).toEqual({
      enabled: false,
      totalMinutes: 30,
    });
  });

  it("supports patching nested sub-objects (lives.total)", () => {
    const { result } = renderHook(() => useQuizSession());

    act(() => {
      result.current.updateConfig({
        lives: { enabled: true, total: 5 },
      });
    });

    expect(result.current.config.lives).toEqual({
      enabled: true,
      total: 5,
    });
    // Other fields preserved
    expect(result.current.config.timePerQuestion).toEqual({
      enabled: true,
      durationMinutes: 4,
    });
  });

  it("supports patching multiple fields at once", () => {
    const { result } = renderHook(() => useQuizSession());

    act(() => {
      result.current.updateConfig({
        generationMode: "exact",
        overallTime: { enabled: true, totalMinutes: 45 },
      });
    });

    expect(result.current.config.generationMode).toBe("exact");
    expect(result.current.config.overallTime).toEqual({
      enabled: true,
      totalMinutes: 45,
    });
    // Untouched fields still there
    expect(result.current.config.lives).toEqual({
      enabled: false,
      total: 3,
    });
    expect(result.current.config.timePerQuestion).toEqual({
      enabled: true,
      durationMinutes: 4,
    });
  });

  it("persists the merged config to sessionStorage", () => {
    const { result } = renderHook(() => useQuizSession());

    act(() => {
      result.current.updateConfig({ generationMode: "exact" });
    });

    const stored = JSON.parse(sessionStorage.getItem(CONFIG_KEY) || "{}");
    expect(stored.generationMode).toBe("exact");
    expect(stored.timePerQuestion).toEqual({
      enabled: true,
      durationMinutes: 4,
    });
    expect(stored.lives).toEqual({
      enabled: false,
      total: 3,
    });
    expect(stored.overallTime).toEqual({
      enabled: false,
      totalMinutes: 30,
    });
  });

  it("regression: end-to-end — generationMode toggle then startSession does NOT lose sub-objects", () => {
    // Reproduce the production path: patch generationMode, then start a
    // session. Before the fix, startSession would store a partial config
    // and the next render would crash on .enabled.
    const { result } = renderHook(() => useQuizSession());

    act(() => {
      result.current.updateConfig({ generationMode: "exact" });
    });

    // The hook now has a fully-formed config even after the patch
    const cfg = result.current.config;
    expect(cfg.timePerQuestion).toBeDefined();
    expect(cfg.lives).toBeDefined();
    expect(cfg.overallTime).toBeDefined();

    // Simulate the QuizPlayer render path: read every .enabled the way
    // App.tsx does. None of these should throw.
    expect(() => cfg.timePerQuestion.enabled).not.toThrow();
    expect(() => cfg.lives.enabled).not.toThrow();
    expect(() => cfg.overallTime.enabled).not.toThrow();
  });
});