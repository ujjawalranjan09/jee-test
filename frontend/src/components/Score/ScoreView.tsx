import { useEffect } from "react";
import type { ScoreResult } from "../../utils/scoring";
import type { QuizSession } from "../../types";
import { saveQuizResult, type QuizHistoryEntry } from "../../utils/quizHistory";
import { updateStreak } from "../../utils/streaks";
import { recordDailyActivity } from "../../utils/heatmap";
import { ShareQuiz } from "../Share/ShareQuiz";
import "./ScoreView.css";

interface Props {
  score: ScoreResult;
  session: QuizSession;
  onReview: () => void;
  onNewQuiz: () => void;
}

export function ScoreView({ score, session, onReview, onNewQuiz }: Props) {
  const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;

  // Save to history and update streak on mount
  useEffect(() => {
    // Per-question timer is the source of truth now. If it was enabled we
    // sum up the captured timeSpentSec per question (includes overtime).
    // If it wasn't enabled, we fall back to a coarse Date.now() delta so
    // legacy/classic sessions still get a sensible number.
    const sumCaptured = Object.values(session.answers).reduce<number>(
      (acc, a) => acc + (typeof a.timeSpentSec === "number" ? a.timeSpentSec : 0),
      0,
    );
    const timeTaken = sumCaptured > 0
      ? sumCaptured
      : Math.round((Date.now() - (session.startedAt ?? Date.now())) / 1000);

    const entry: QuizHistoryEntry = {
      id: `quiz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: new Date().toISOString(),
      quizTitle: `Quiz (${score.total} questions)`,
      totalQuestions: score.total,
      correct: score.correct,
      incorrect: score.incorrect,
      unanswered: score.unanswered,
      percentage: pct,
      timeTaken,
      topics: {},
      difficulty: "mixed",
    };

    saveQuizResult(entry);
    updateStreak();
    recordDailyActivity();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const grade =
    pct >= 90
      ? "Excellent!"
      : pct >= 70
        ? "Good Job!"
        : pct >= 50
          ? "Keep Practicing"
          : "Needs Improvement";

  const gradeColor =
    pct >= 70
      ? "var(--color-correct)"
      : pct >= 50
        ? "var(--color-accent)"
        : "var(--color-incorrect)";

  return (
    <div className="score-view">
      <div className="container">
        <div className="score-view__card card">
          <h1 className="score-view__heading">Quiz Complete</h1>

          <div className="score-view__ring" style={{ "--pct": pct, "--grade-color": gradeColor } as React.CSSProperties}>
            <svg viewBox="0 0 120 120" className="score-view__ring-svg">
              <circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke="var(--color-surface-raised)"
                strokeWidth="8"
              />
              <circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke={gradeColor}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 339.292} 339.292`}
                transform="rotate(-90 60 60)"
                className="score-view__ring-progress"
              />
            </svg>
            <div className="score-view__ring-label">
              <span className="score-view__pct">{pct}%</span>
              <span className="score-view__grade" style={{ color: gradeColor }}>
                {grade}
              </span>
            </div>
          </div>

          <div className="score-view__stats">
            <div className="score-view__stat score-view__stat--correct">
              <span className="score-view__stat-value">{score.correct}</span>
              <span className="score-view__stat-label">Correct</span>
            </div>
            <div className="score-view__stat score-view__stat--incorrect">
              <span className="score-view__stat-value">{score.incorrect}</span>
              <span className="score-view__stat-label">Incorrect</span>
            </div>
            <div className="score-view__stat score-view__stat--unanswered">
              <span className="score-view__stat-value">{score.unanswered}</span>
              <span className="score-view__stat-label">Unanswered</span>
            </div>
          </div>

          <div className="score-view__actions">
            <button className="btn-primary" onClick={onReview}>
              Review Answers
            </button>
            <button className="btn-secondary" onClick={onNewQuiz}>
              New Quiz
            </button>
          </div>

          <div className="score-view__share">
            <ShareQuiz quiz={session.quiz} />
          </div>
        </div>
      </div>
    </div>
  );
}
