import { useMemo } from "react";
import { getQuizHistory, clearHistory, type QuizHistoryEntry } from "../../utils/quizHistory";
import { Heatmap } from "./Heatmap";
import "./HistoryView.css";

interface Props {
  onBack: () => void;
}

export function HistoryView({ onBack }: Props) {
  const history = useMemo(() => getQuizHistory(), []);

  const totalQuizzes = history.length;
  const avgScore =
    totalQuizzes > 0
      ? Math.round(history.reduce((s, e) => s + e.percentage, 0) / totalQuizzes)
      : 0;
  const bestScore = totalQuizzes > 0 ? Math.max(...history.map((e) => e.percentage)) : 0;

  // Per-topic aggregation
  const topicStats = useMemo(() => {
    const map: Record<string, { correct: number; total: number }> = {};
    for (const entry of history) {
      for (const [topic, data] of Object.entries(entry.topics)) {
        if (!map[topic]) map[topic] = { correct: 0, total: 0 };
        map[topic].correct += data.correct;
        map[topic].total += data.total;
      }
    }
    return Object.entries(map)
      .map(([topic, data]) => ({
        topic,
        correct: data.correct,
        total: data.total,
        pct: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [history]);

  // Last 10 for chart
  const chartData = useMemo(() => history.slice(0, 10).reverse(), [history]);

  const handleClear = () => {
    if (confirm("Clear all quiz history? This cannot be undone.")) {
      clearHistory();
      window.location.reload();
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="history-view">
      <div className="container container--wide">
        <div className="history-view__header">
          <h1 className="history-view__title">Quiz History</h1>
          <div className="history-view__header-actions">
            {totalQuizzes > 0 && (
              <button className="btn-ghost" onClick={handleClear}>
                Clear History
              </button>
            )}
            <button className="btn-secondary" onClick={onBack}>
              ← Back
            </button>
          </div>
        </div>

        {totalQuizzes === 0 ? (
          <div className="history-view__empty card">
            <p>No quiz history yet. Complete a quiz to see your results here!</p>
          </div>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="history-view__summary">
              <div className="history-view__stat card">
                <span className="history-view__stat-value">{totalQuizzes}</span>
                <span className="history-view__stat-label">Quizzes Taken</span>
              </div>
              <div className="history-view__stat card">
                <span className="history-view__stat-value">{avgScore}%</span>
                <span className="history-view__stat-label">Average Score</span>
              </div>
              <div className="history-view__stat card">
                <span className="history-view__stat-value">{bestScore}%</span>
                <span className="history-view__stat-label">Best Score</span>
              </div>
            </div>

            {/* Progress Heatmap */}
            <Heatmap />

            {/* Bar Chart - Last 10 Scores */}
            {chartData.length > 1 && (
              <div className="history-view__chart card">
                <h2 className="history-view__section-title">Last {chartData.length} Scores</h2>
                <div className="history-view__bars">
                  {chartData.map((entry, i) => (
                    <div key={entry.id} className="history-view__bar-col">
                      <span className="history-view__bar-value">{entry.percentage}%</span>
                      <div className="history-view__bar-track">
                        <div
                          className="history-view__bar-fill"
                          style={{ height: `${entry.percentage}%` }}
                        />
                      </div>
                      <span className="history-view__bar-label">{i + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Topic Breakdown */}
            {topicStats.length > 0 && (
              <div className="history-view__topics card">
                <h2 className="history-view__section-title">Topic Breakdown</h2>
                <div className="history-view__topic-list">
                  {topicStats.map((t) => (
                    <div key={t.topic} className="history-view__topic-row">
                      <span className="history-view__topic-name">{t.topic}</span>
                      <div className="history-view__topic-bar-track">
                        <div
                          className={`history-view__topic-bar-fill ${t.pct >= 70 ? "history-view__topic-bar-fill--strong" : t.pct >= 50 ? "history-view__topic-bar-fill--medium" : "history-view__topic-bar-fill--weak"}`}
                          style={{ width: `${t.pct}%` }}
                        />
                      </div>
                      <span className="history-view__topic-pct">{t.pct}%</span>
                      <span className="history-view__topic-count">
                        {t.correct}/{t.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Past Attempts List */}
            <div className="history-view__list">
              <h2 className="history-view__section-title">All Attempts</h2>
              {history.map((entry) => (
                <div key={entry.id} className="history-view__item card">
                  <div className="history-view__item-main">
                    <span className="history-view__item-title">{entry.quizTitle}</span>
                    <span className="history-view__item-date">{formatDate(entry.date)}</span>
                  </div>
                  <div className="history-view__item-stats">
                    <span className="history-view__item-score">{entry.percentage}%</span>
                    <span className="history-view__item-detail">
                      {entry.correct}/{entry.totalQuestions} correct
                    </span>
                    <span className="history-view__item-difficulty">{entry.difficulty}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
