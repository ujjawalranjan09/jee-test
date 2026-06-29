import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Per-question countdown timer.
 *
 * Contract:
 *   - `enabled`  : when false, the timer is hidden (no display, no ticking).
 *   - `durationSeconds` : how many seconds the user has to answer this question.
 *   - `start()`  : begin the countdown for the current question.
 *   - `stop()`   : pause + freeze the displayed value (used when user answers).
 *   - `reset(seconds)` : re-arm for a new question with a fresh duration.
 *   - `elapsedOnFreeze` : seconds spent on the question when it was frozen.
 *                        Undefined while the timer is still running.
 *
 * Display semantics:
 *   - `remaining >= 0`         → normal countdown ("1:23")
 *   - `remaining <  0`         → overtime, shows as red "−0:15" / "+0:15 overtime"
 *   - When `remaining` hits 0, the device vibrates once (if Vibration API is
 *     supported — silently no-op on desktop). After that the timer keeps
 *     ticking so the user can see how far over time they went.
 *
 * The hook intentionally does NOT auto-submit or auto-advance — it just
 * exposes state. Decisions about lives/game-over are in `useQuizSession`.
 */
export function useTimer(durationSeconds: number, enabled: boolean) {
  const [remaining, setRemaining] = useState(durationSeconds);
  const [running, setRunning] = useState(false);
  const [elapsedOnFreeze, setElapsedOnFreeze] = useState<number | undefined>(
    undefined,
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vibratedRef = useRef(false);
  const onExpireRef = useRef<(() => void) | null>(null);

  const start = useCallback(() => {
    setElapsedOnFreeze(undefined);
    vibratedRef.current = false;
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    // Freeze the elapsed time so the review screen can show it.
    setElapsedOnFreeze((prev) => {
      if (prev !== undefined) return prev;
      return Math.max(0, durationSeconds - remaining);
    });
    setRunning(false);
  }, [durationSeconds, remaining]);

  const reset = useCallback(
    (seconds: number) => {
      setRemaining(seconds);
      setElapsedOnFreeze(undefined);
      vibratedRef.current = false;
      setRunning(false);
    },
    [],
  );

  const onExpire = useCallback((cb: () => void) => {
    onExpireRef.current = cb;
  }, []);

  useEffect(() => {
    if (!enabled || !running) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1;

        // Crossing 0 — vibrate once, fire the expire callback.
        if (prev > 0 && next <= 0 && !vibratedRef.current) {
          vibratedRef.current = true;
          if (
            typeof navigator !== "undefined" &&
            typeof navigator.vibrate === "function"
          ) {
            // Three short pulses — distinctive "time's up" feel.
            try {
              navigator.vibrate([200, 100, 200]);
            } catch {
              /* some browsers throw if not user-activated — silent */
            }
          }
          onExpireRef.current?.();
        }
        return next;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, running]);

  return {
    remaining,
    running,
    elapsedOnFreeze,
    start,
    stop,
    reset,
    onExpire,
  };
}
