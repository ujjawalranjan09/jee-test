import { describe, it, expect, beforeEach, vi } from "vitest";
import { getStreak, updateStreak, getBestStreak } from "../utils/streaks";

describe("streaks", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns 0 when no streak data", () => {
    expect(getStreak()).toBe(0);
  });

  it("returns 0 for best streak when no data", () => {
    expect(getBestStreak()).toBe(0);
  });

  it("starts streak at 1 on first quiz", () => {
    updateStreak();
    expect(getStreak()).toBe(1);
    expect(getBestStreak()).toBe(1);
  });

  it("does not double-count same day", () => {
    updateStreak();
    updateStreak();
    expect(getStreak()).toBe(1);
  });

  it("increments streak on consecutive days", () => {
    // First day
    updateStreak();
    expect(getStreak()).toBe(1);

    // Simulate yesterday by manipulating localStorage
    const data = JSON.parse(localStorage.getItem("qf_streak")!);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    data.lastDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    localStorage.setItem("qf_streak", JSON.stringify(data));

    updateStreak();
    expect(getStreak()).toBe(2);
    expect(getBestStreak()).toBe(2);
  });

  it("resets streak when gap is more than 1 day", () => {
    updateStreak();
    expect(getStreak()).toBe(1);

    // Simulate 3 days ago
    const data = JSON.parse(localStorage.getItem("qf_streak")!);
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    data.lastDate = `${threeDaysAgo.getFullYear()}-${String(threeDaysAgo.getMonth() + 1).padStart(2, "0")}-${String(threeDaysAgo.getDate()).padStart(2, "0")}`;
    localStorage.setItem("qf_streak", JSON.stringify(data));

    updateStreak();
    expect(getStreak()).toBe(1);
  });

  it("preserves best streak even when current resets", () => {
    // Build up a streak of 3
    updateStreak();
    let data = JSON.parse(localStorage.getItem("qf_streak")!);
    data.lastDate = "2020-01-01";
    data.current = 3;
    data.best = 3;
    localStorage.setItem("qf_streak", JSON.stringify(data));

    // Reset by doing a quiz now
    updateStreak();
    expect(getStreak()).toBe(1);
    expect(getBestStreak()).toBe(3);
  });
});
