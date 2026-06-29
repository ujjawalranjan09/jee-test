import "./ChallengeMode.css";

interface Props {
  /** Total lives configured at session start. */
  total: number;
  /** Lives still remaining (0..total). */
  remaining: number;
}

/**
 * Visual hearts strip for the lives option.
 * Shows `total` hearts; remaining are red, lost are grey.
 *
 * Hidden entirely when total === 0 (lives option disabled) — the caller
 * can also just not render this component in that case.
 */
export function LivesIndicator({ total, remaining }: Props) {
  if (total <= 0) return null;

  return (
    <div
      className="lives-indicator"
      role="status"
      aria-live="polite"
      aria-label={`${remaining} of ${total} lives remaining`}
    >
      {Array.from({ length: total }, (_, i) => {
        const alive = i < remaining;
        return (
          <span
            key={i}
            className={`lives-indicator__heart ${alive ? "lives-indicator__heart--alive" : "lives-indicator__heart--dead"}`}
            aria-label={alive ? "Life remaining" : "Life lost"}
          >
            {alive ? "❤️" : "🖤"}
          </span>
        );
      })}
      <span className="lives-indicator__text">
        {remaining} {remaining === 1 ? "life" : "lives"}
      </span>
    </div>
  );
}
