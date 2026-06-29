import "./CountdownTimer.css";

interface Props {
  /** Seconds remaining. May be NEGATIVE if the user went past the time
   *  limit — the component renders that case as red overtime. */
  remainingSeconds: number;
}

/**
 * Renders a countdown timer. Handles three states:
 *   1. remaining > 0    → normal countdown ("1:23")
 *   2. remaining === 0  → hidden border / pulse so we don't show "0:00" right
 *                         before the negative phase kicks in
 *   3. remaining < 0    → overtime ("-0:15") in red, pulses
 */
export function CountdownTimer({ remainingSeconds }: Props) {
  // Hide the *initial* zero — the very first frame after expiry is a transient
  // state; if the user is still on the question we'll see -1, -2, etc. right
  // away. If they answered/advanced we won't see this component at all.
  if (remainingSeconds === 0) return null;

  const overtime = remainingSeconds < 0;
  const absSeconds = Math.abs(remainingSeconds);

  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const seconds = absSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  const className = [
    "countdown-timer",
    overtime && "countdown-timer--overtime",
    !overtime && remainingSeconds <= 60 && "countdown-timer--critical",
    !overtime &&
      remainingSeconds > 60 &&
      remainingSeconds <= 300 &&
      "countdown-timer--low",
  ]
    .filter(Boolean)
    .join(" ");

  const sign = overtime ? "−" : "";

  return (
    <div
      className={className}
      role="timer"
      aria-live={overtime ? "assertive" : "polite"}
      title={overtime ? "Time's up — counting overtime" : "Time remaining"}
    >
      {hours > 0 && (
        <>
          <span className="countdown-timer__digit">{pad(hours)}</span>
          <span className="countdown-timer__sep">:</span>
        </>
      )}
      <span className="countdown-timer__digit">{pad(minutes)}</span>
      <span className="countdown-timer__sep">:</span>
      <span className="countdown-timer__digit">{pad(seconds)}</span>
      <span className="sr-only">{overtime ? "overtime" : ""}</span>
      {/* Visible sign is rendered inline with the seconds via CSS — keeping
          it in the DOM tree makes screen readers announce "minus 0:15". */}
      {overtime && <span className="countdown-timer__sign" aria-hidden="true">{sign}</span>}
    </div>
  );
}
