import { useMemo } from "react";
import { generateHeatmapGrid, getHeatmapStats, type HeatmapDay } from "../../utils/heatmap";
import "./Heatmap.css";

interface Props {
  weeks?: number;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

export function Heatmap({ weeks = 24 }: Props) {
  const grid = useMemo(() => generateHeatmapGrid(weeks), [weeks]);
  const stats = useMemo(() => getHeatmapStats(), []);

  // Generate month labels
  const monthLabels = useMemo(() => {
    const labels: { label: string; offset: number }[] = [];
    let lastMonth = -1;

    grid.forEach((week, weekIdx) => {
      const firstDay = week.days.find((d) => d.date);
      if (!firstDay?.date) return;
      const month = new Date(firstDay.date).getMonth();
      if (month !== lastMonth) {
        labels.push({ label: MONTH_LABELS[month] ?? "", offset: weekIdx });
        lastMonth = month;
      }
    });

    return labels;
  }, [grid]);

  const getTooltip = (day: HeatmapDay): string => {
    if (!day.date) return "";
    const d = new Date(day.date + "T00:00:00");
    const dateStr = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (day.count === 0) return `${dateStr}: No quizzes`;
    return `${dateStr}: ${day.count} quiz${day.count > 1 ? "zes" : ""}`;
  };

  return (
    <div className="heatmap">
      <div className="heatmap__header">
        <h2 className="heatmap__title">Study Activity</h2>
        <div className="heatmap__legend">
          <span className="heatmap__legend-label">Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className={`heatmap__cell heatmap__cell--level-${level}`} />
          ))}
          <span className="heatmap__legend-label">More</span>
        </div>
      </div>

      <div className="heatmap__grid-wrapper">
        {/* Day labels (Mon, Wed, Fri) */}
        <div className="heatmap__day-labels">
          {DAY_LABELS.map((label, i) => (
            <span key={i} className="heatmap__day-label">{label}</span>
          ))}
        </div>

        {/* Grid */}
        <div className="heatmap__grid">
          {/* Month labels */}
          <div className="heatmap__month-labels">
            {monthLabels.map((m, i) => (
              <span
                key={i}
                className="heatmap__month-label"
                style={{ left: `${m.offset * 14}px` }}
              >
                {m.label}
              </span>
            ))}
          </div>

          {/* Cells */}
          <div className="heatmap__cells">
            {grid.map((week, wi) => (
              <div key={wi} className="heatmap__week">
                {week.days.map((day, di) => (
                  <span
                    key={di}
                    className={`heatmap__cell heatmap__cell--level-${day.level}${!day.date ? " heatmap__cell--empty" : ""}`}
                    title={getTooltip(day)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="heatmap__stats">
        <div className="heatmap__stat">
          <span className="heatmap__stat-value">{stats.totalActiveDays}</span>
          <span className="heatmap__stat-label">Active Days</span>
        </div>
        <div className="heatmap__stat">
          <span className="heatmap__stat-value">{stats.currentStreak}</span>
          <span className="heatmap__stat-label">Current Streak</span>
        </div>
        <div className="heatmap__stat">
          <span className="heatmap__stat-value">{stats.longestStreak}</span>
          <span className="heatmap__stat-label">Longest Streak</span>
        </div>
        <div className="heatmap__stat">
          <span className="heatmap__stat-value">{stats.totalQuizzes}</span>
          <span className="heatmap__stat-label">Total Quizzes</span>
        </div>
      </div>
    </div>
  );
}
