import { useMemo } from "react";
import { getQuizHistory, type QuizHistoryEntry } from "../../utils/quizHistory";
import { getStreak, getBestStreak } from "../../utils/streaks";
import "./LeaderboardView.css";

interface Props {
  onBack: () => void;
}

export function LeaderboardView({ onBack }: Props) {
  const history = useMemo(() => getQuizHistory(), []);
  const currentStreak = getStreak();
  const bestStreak = getBestStreak();
  const totalQuizzes = history.length;
  const avgScore =
    totalQuizzes > 0
      ? Math.round(history.reduce((s, e) => s + e.percentage, 0) / totalQuizzes)
      : 0;

  // Top 3 personal bests
  const top3 = useMemo(() => {
    const sorted = [...history].sort((a, b) => b.percentage - a.percentage);
    return sorted.slice(0, 3);
  }, [history]);

  // Rank distribution
  const rankDist = useMemo(() => {
    const ranks = { s: 0, a: 0, b: 0, c: 0, d: 0 };
    for (const entry of history) {
      if (entry.percentage >= 90) ranks.s++;
      else if (entry.percentage >= 80) ranks.a++;
      else if (entry.percentage >= 70) ranks.b++;
      else if (entry.percentage >= 50) ranks.c++;
      else ranks.d++;
    }
    return ranks;
  }, [history]);

  const getRankLabel = (pct: number): string => {
    if (pct >= 90) return "S";
    if (pct >= 80) return "A";
    if (pct >= 70) return "B";
    if (pct >= 50) return "C";
    return "D";
  };

  const getRankColor = (pct: number): string => {
    if (pct >= 90) return "var(--color-accent)";
    if (pct >= 80) return "var(--color-correct)";
    if (pct >= 70) return "var(--color-info)";
    if (pct >= 50) return "var(--color-text-secondary)";
    return "var(--color-incorrect)";
  };

  const trophyIcons = ["🏆", "🥈", "🥉"];

  return (
    <div className="leaderboard-view">
      <div className="container container--wide">
        <div className="leaderboard-view__header">
          <h1 className="leaderboard-view__title">Leaderboard</h1>
          <button className="btn-secondary" onClick={onBack}>
            ← Back
          </button>
        </div>

        {/* Personal Stats */}
        <div className="leaderboard-view__stats">
          <div className="leaderboard-view__stat card">
            <span className="leaderboard-view__stat-icon">🔥</span>
            <span className="leaderboard-view__stat-value">{currentStreak}</span>
            <span className="leaderboard-view__stat-label">Current Streak</span>
          </div>
          <div className="leaderboard-view__stat card">
            <span className="leaderboard-view__stat-icon">⭐</span>
            <span className="leaderboard-view__stat-value">{bestStreak}</span>
            <span className="leaderboard-view__stat-label">Best Streak</span>
          </div>
          <div className="leaderboard-view__stat card">
            <span className="leaderboard-view__stat-icon">📝</span>
            <span className="leaderboard-view__stat-value">{totalQuizzes}</span>
            <span className="leaderboard-view__stat-label">Total Quizzes</span>
          </div>
          <div className="leaderboard-view__stat card">
            <span className="leaderboard-view__stat-icon">📊</span>
            <span className="leaderboard-view__stat-value">{avgScore}%</span>
            <span className="leaderboard-view__stat-label">Average Score</span>
          </div>
        </div>

        {/* Top 3 Personal Bests */}
        {top3.length > 0 && (
          <div className="leaderboard-view__top3 card">
            <h2 className="leaderboard-view__section-title">Personal Bests</h2>
            <div className="leaderboard-view__top3-list">
              {top3.map((entry, i) => (
                <div key={entry.id} className="leaderboard-view__top3-item">
                  <span className="leaderboard-view__trophy">{trophyIcons[i]}</span>
                  <div className="leaderboard-view__top3-info">
                    <span className="leaderboard-view__top3-title">{entry.quizTitle}</span>
                    <span className="leaderboard-view__top3-date">
                      {new Date(entry.date).toLocaleDateString()}
                    </span>
                  </div>
                  <span className="leaderboard-view__top3-score">{entry.percentage}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rank Distribution */}
        {totalQuizzes > 0 && (
          <div className="leaderboard-view__ranks card">
            <h2 className="leaderboard-view__section-title">Rank Distribution</h2>
            <div className="leaderboard-view__rank-grid">
              {(["s", "a", "b", "c", "d"] as const).map((rank) => {
                const count = rankDist[rank];
                const label = rank.toUpperCase();
                const pct = totalQuizzes > 0 ? Math.round((count / totalQuizzes) * 100) : 0;
                return (
                  <div key={rank} className="leaderboard-view__rank-item">
                    <span className={`leaderboard-view__rank-badge leaderboard-view__rank-badge--${rank}`}>
                      {label}
                    </span>
                    <span className="leaderboard-view__rank-count">{count}</span>
                    <span className="leaderboard-view__rank-pct">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {totalQuizzes === 0 && (
          <div className="leaderboard-view__empty card">
            <p>Complete quizzes to build your leaderboard stats!</p>
          </div>
        )}
      </div>
    </div>
  );
}
