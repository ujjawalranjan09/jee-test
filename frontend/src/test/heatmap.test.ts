import { describe, it, expect, beforeEach } from "vitest";
import {
  recordDailyActivity,
  getActivity,
  getActivityForDate,
  generateHeatmapGrid,
  getHeatmapStats,
} from "../utils/heatmap";

beforeEach(() => {
  localStorage.clear();
});

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("heatmap", () => {
  describe("recordDailyActivity", () => {
    it("records one quiz for today", () => {
      recordDailyActivity();
      const activity = getActivity();
      expect(activity[todayKey()]).toBe(1);
    });

    it("increments count on multiple calls", () => {
      recordDailyActivity();
      recordDailyActivity();
      recordDailyActivity();
      expect(getActivityForDate(todayKey())).toBe(3);
    });
  });

  describe("generateHeatmapGrid", () => {
    it("returns the requested number of weeks", () => {
      const grid = generateHeatmapGrid(10);
      // Should be around 10 weeks (may vary by 1 due to alignment)
      expect(grid.length).toBeGreaterThanOrEqual(9);
      expect(grid.length).toBeLessThanOrEqual(12);
    });

    it("each week has 7 days", () => {
      const grid = generateHeatmapGrid(4);
      for (const week of grid) {
        expect(week.days).toHaveLength(7);
      }
    });

    it("today is included in the grid", () => {
      const grid = generateHeatmapGrid(4);
      const today = todayKey();
      const found = grid.some((w) => w.days.some((d) => d.date === today));
      expect(found).toBe(true);
    });

    it("assigns correct levels", () => {
      // Record 5 quizzes today
      for (let i = 0; i < 5; i++) recordDailyActivity();

      const grid = generateHeatmapGrid(2);
      const today = todayKey();
      const todayCell = grid.flatMap((w) => w.days).find((d) => d.date === today);
      expect(todayCell).toBeDefined();
      expect(todayCell!.count).toBe(5);
      expect(todayCell!.level).toBe(4); // 5 quizzes = level 4
    });
  });

  describe("getHeatmapStats", () => {
    it("returns zero stats when no activity", () => {
      const stats = getHeatmapStats();
      expect(stats.totalActiveDays).toBe(0);
      expect(stats.totalQuizzes).toBe(0);
      expect(stats.currentStreak).toBe(0);
    });

    it("counts today as active after recording", () => {
      recordDailyActivity();
      const stats = getHeatmapStats();
      expect(stats.totalActiveDays).toBe(1);
      expect(stats.totalQuizzes).toBe(1);
      expect(stats.currentStreak).toBe(1);
    });
  });
});
