import { useState, useRef, useCallback } from "react";
import type React from "react";
import { solveQuestion } from "../../api/client";
import type { Question, Diagram } from "../../types";
import { Markdown } from "../../utils/markdown";
// KaTeX stylesheet — must be imported once for math symbols + fonts to
// render correctly. Side-effect import only.
import "katex/dist/katex.min.css";
import "./SolutionPanel.css";

interface Props {
  question: Question;
  diagramMap: Record<string, Diagram>;
}

// Cache the in-flight (or completed) solve calls by question id so
// repeated toggles don't trigger duplicate LLM hits. The cached value
// includes the cross-check info, not just the prose.
interface SolveCached {
  solution: string;
  parsedAnswer: string | null;
  originalAnswer: string | null;
  answersMatch: boolean | null;
}
const inflight = new Map<string, Promise<SolveCached>>();

// Test helper: lets tests clear the module-level cache between cases
// so each one starts fresh. Not exported in production code paths.
export function _clearSolveInflightForTests(): void {
  inflight.clear();
}

/**
 * Type-aware mismatch description for the cross-check warning.
 * Handles single ("option C"), multiple ("options B, C"), and numerical
 * ("answer 25"). Falls back to a generic phrasing when types don't match
 * the expected shapes.
 */
function mismatchDescription(
  qtype: Question["type"] | undefined,
  crossCheck: {
    parsedAnswer: string | null;
    originalAnswer: string | null;
  },
): React.ReactNode {
  const { parsedAnswer, originalAnswer } = crossCheck;
  const parsed = parsedAnswer ?? "?";
  const original = originalAnswer ?? "?";
  if (qtype === "numerical") {
    return (
      <>
        The quiz marked <strong className="solution-panel__mismatch-letter">{original}</strong>{" "}
        as the answer, but our solver arrived at{" "}
        <strong className="solution-panel__mismatch-letter solution-panel__mismatch-letter--correct">
          {parsed}
        </strong>
        . The solver's reasoning is shown below — please trust the step-by-step
        working over the originally marked answer.
      </>
    );
  }
  if (qtype === "multiple") {
    return (
      <>
        The quiz marked options{" "}
        <strong className="solution-panel__mismatch-letter">{original}</strong>{" "}
        as correct, but our solver arrived at{" "}
        <strong className="solution-panel__mismatch-letter solution-panel__mismatch-letter--correct">
          {parsed}
        </strong>
        . The solver's reasoning is shown below — please trust the step-by-step
        working over the originally marked answer.
      </>
    );
  }
  // single (default)
  return (
    <>
      The quiz marked option{" "}
      <strong className="solution-panel__mismatch-letter">{original}</strong>{" "}
      as correct, but our solver arrived at{" "}
      <strong className="solution-panel__mismatch-letter solution-panel__mismatch-letter--correct">
        {parsed}
      </strong>
      . The solver's reasoning is shown below — please trust the step-by-step
      working over the originally marked answer.
    </>
  );
}

export function SolutionPanel({ question, diagramMap }: Props) {
  const [solution, setSolution] = useState<string | null>(null);
  const [crossCheck, setCrossCheck] = useState<{
    parsedAnswer: string | null;
    originalAnswer: string | null;
    answersMatch: boolean | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSolution = useCallback(async () => {
    if (solution) {
      setExpanded(!expanded);
      return;
    }

    setLoading(true);
    setError("");

    const cacheKey = question.id;

    try {
      let promise = inflight.get(cacheKey);
      if (!promise) {
        const diagrams = question.diagramIds
          .map((dId) => diagramMap[dId])
          .filter((d): d is Diagram => Boolean(d));
        // Pass the original correctAnswerId so the backend can
        // cross-check the solver's answer against it. This catches
        // hallucinated answers from quiz generation (the model can
        // solve correctly when prompted directly but pick the wrong
        // correctAnswerId when pressured to invent 4 options in one
        // JSON batch). For numerical questions we pass the expected
        // number directly so the backend's numeric-tolerant match
        // is used.
        const questionType = question.type ?? "single";
        promise = solveQuestion(
          question.prompt,
          question.options,
          diagrams,
          60_000,
          {
            correctAnswerId:
              questionType === "single" ? question.correctAnswerId || undefined : undefined,
            questionType,
            numericalAnswer: question.numericalAnswer ?? undefined,
            numericalTolerance: question.numericalTolerance ?? 0,
          },
        ).then((r) => ({
          solution: r.solution,
          parsedAnswer: r.parsedAnswer,
          originalAnswer: r.originalAnswer,
          answersMatch: r.answersMatch,
        }));
        inflight.set(cacheKey, promise);
      }

      const result = await promise;
      setSolution(result.solution);
      setCrossCheck({
        parsedAnswer: result.parsedAnswer,
        originalAnswer: result.originalAnswer,
        answersMatch: result.answersMatch,
      });
      setExpanded(true);
    } catch (err: unknown) {
      inflight.delete(cacheKey);
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          setError("Request timed out. Please try again.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Failed to load solution.");
      }
    } finally {
      setLoading(false);
    }
  }, [question, diagramMap, solution, expanded]);

  // Render a prominent warning when the solver disagrees with the
  // answer the quiz was generated with. This is the bug from the
  // screenshot — the quiz marked C as correct, the solver computed
  // D. Showing the warning lets the student know which one is
  // actually right (the solver's) instead of silently misleading.
  const showMismatchWarning =
    crossCheck &&
    crossCheck.answersMatch === false &&
    crossCheck.parsedAnswer &&
    crossCheck.originalAnswer;

  return (
    <div className="solution-panel">
      <button
        className="btn-ghost solution-panel__toggle"
        onClick={fetchSolution}
        disabled={loading}
      >
        {loading ? (
          <>
            <span className="spinner" /> Loading…
          </>
        ) : solution ? (
          expanded ? (
            "Hide Solution"
          ) : (
            "Show Solution"
          )
        ) : (
          "📖 View Solution"
        )}
      </button>

      {error && (
        <div className="solution-panel__error" role="alert">
          <span>{error}</span>
          <button className="btn-ghost solution-panel__retry" onClick={fetchSolution}>
            Retry
          </button>
        </div>
      )}

      {solution && expanded && (
        <div className="solution-panel__content">
          {showMismatchWarning && (
            <div
              className="solution-panel__mismatch"
              role="alert"
              aria-live="polite"
            >
              <div className="solution-panel__mismatch-icon" aria-hidden="true">
                ⚠️
              </div>
              <div className="solution-panel__mismatch-body">
                <strong className="solution-panel__mismatch-title">
                  Possible wrong answer in this quiz
                </strong>
                <p className="solution-panel__mismatch-text">
                  {mismatchDescription(question.type, crossCheck)}
                </p>
              </div>
            </div>
          )}
          <div className="solution-panel__text">
            <Markdown source={solution} />
          </div>
        </div>
      )}
    </div>
  );
}