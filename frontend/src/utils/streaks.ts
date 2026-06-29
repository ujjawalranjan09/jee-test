import { getJson, setJson } from "./storage";

const STREAK_KEY = "qf_streak";

interface StreakData {
  current: number;
  best: number;
  lastDate: string; // YYYY-MM-DD
}

function loadStreak(): StreakData {
  return getJson<StreakData>(STREAK_KEY, { current: 0, best: 0, lastDate: "" });
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getStreak(): number {
  const data = loadStreak();
  const today = todayStr();
  // If last date is not today or yesterday, streak is broken
  if (data.lastDate !== today && data.lastDate !== yesterdayStr()) {
    return 0;
  }
  return data.current;
}

export function getBestStreak(): number {
  return loadStreak().best;
}

export function updateStreak(): void {
  const data = loadStreak();
  const today = todayStr();

  if (data.lastDate === today) {
    // Already counted today
    return;
  }

  if (data.lastDate === yesterdayStr()) {
    // Consecutive day
    data.current += 1;
  } else {
    // Streak broken or first quiz
    data.current = 1;
  }

  data.lastDate = today;
  if (data.current > data.best) {
    data.best = data.current;
  }

  setJson(STREAK_KEY, data);
}
