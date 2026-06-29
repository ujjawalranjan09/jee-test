import { getJson, setJson, remove } from "./storage";

const HISTORY_KEY = "qf_quiz_history";

export interface QuizHistoryEntry {
  id: string;
  date: string; // ISO string
  quizTitle: string;
  totalQuestions: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  percentage: number;
  timeTaken: number; // seconds
  topics: Record<string, { correct: number; total: number }>;
  difficulty: string;
}

export function saveQuizResult(entry: QuizHistoryEntry): void {
  const history = getQuizHistory();
  history.unshift(entry);
  // Keep last 100 entries
  if (history.length > 100) history.length = 100;
  setJson(HISTORY_KEY, history);
}

export function getQuizHistory(): QuizHistoryEntry[] {
  return getJson<QuizHistoryEntry[]>(HISTORY_KEY, []);
}

export function clearHistory(): void {
  remove(HISTORY_KEY);
}
