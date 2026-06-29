/**
 * Progress heatmap — tracks daily study activity.
 * Stores dates with quiz completions in localStorage.
 */

import { getJson, setJson } from "./storage";

const ACTIVITY_KEY = "qf_daily_activity";

interface ActivityMap {
  [date: string]: number; // date -> number of quizzes completed that day
}

/**
 * Record a quiz completion for today.
 */
export function recordDailyActivity(): void {
  const today = getTodayKey();
  const activity = getActivity();
  activity[today] = (activity[today] ?? 0) + 1;
  setJson(ACTIVITY_KEY, activity);
}

/**
 * Get all activity data.
 */
export function getActivity(): ActivityMap {
  return getJson<ActivityMap>(ACTIVITY_KEY, {});
}

/**
 * Get activity count for a specific date.
 */
export function getActivityForDate(dateStr: string): number {
  const activity = getActivity();
  return activity[dateStr] ?? 0;
}

/**
 * Get today's date as YYYY-MM-DD.
 */
function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Generate heatmap grid data for the last N weeks.
 * Returns an array of weeks, each containing 7 days (Mon-Sun).
 */
export interface HeatmapDay {
  date: string; // YYYY-MM-DD
  count: number;
  level: 0 | 1 | 2 | 3 | 4; // intensity level (0 = none, 4 = highest)
}

export interface HeatmapWeek {
  days: HeatmapDay[];
}

export function generateHeatmapGrid(weeks: number = 24): HeatmapWeek[] {
  const activity = getActivity();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find the most recent Sunday (end of current week)
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay())); // Next Sunday... actually let's use Saturday

  // Actually, let's end on today and start from N weeks ago
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7) + 1);

  // Adjust start to the Monday of that week
  const dayOfWeek = start.getDay(); // 0=Sun, 1=Mon...
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // days since Monday
  start.setDate(start.getDate() - offset);

  const grid: HeatmapWeek[] = [];
  const current = new Date(start);

  while (current <= today) {
    const week: HeatmapWeek = { days: [] };

    for (let d = 0; d < 7; d++) {
      const dateStr = formatDate(current);
      const count = activity[dateStr] ?? 0;
      const level = getLevel(count);

      week.days.push({ date: dateStr, count, level });

      current.setDate(current.getDate() + 1);

      // Stop if we've passed today
      if (current > today) {
        // Fill remaining days in the week with empty
        for (let e = d + 1; e < 7; e++) {
          week.days.push({ date: "", count: 0, level: 0 });
        }
        break;
      }
    }

    grid.push(week);
  }

  return grid;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

/**
 * Get total active days and current streak from activity data.
 */
export function getHeatmapStats(): {
  totalActiveDays: number;
  currentStreak: number;
  longestStreak: number;
  totalQuizzes: number;
} {
  const activity = getActivity();
  const dates = Object.keys(activity).sort().reverse();
  const totalActiveDays = dates.length;
  const totalQuizzes = Object.values(activity).reduce((s, n) => s + n, 0);

  // Current streak (consecutive days ending today)
  let currentStreak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = formatDate(d);
    if (activity[key]) {
      currentStreak++;
    } else {
      break;
    }
  }

  // Longest streak
  let longestStreak = 0;
  let streak = 0;
  const sortedAsc = Object.keys(activity).sort();
  for (let i = 0; i < sortedAsc.length; i++) {
    if (i === 0) {
      streak = 1;
    } else {
      const prev = new Date(sortedAsc[i - 1]!);
      const curr = new Date(sortedAsc[i]!);
      const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        streak++;
      } else {
        streak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, streak);
  }

  return { totalActiveDays, currentStreak, longestStreak, totalQuizzes };
}
