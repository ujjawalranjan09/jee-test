import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { QuizSession, AnswerState, QuestionStatus } from "../../types";
import { CountdownTimer } from "./CountdownTimer";
import { QuestionPalette } from "./QuestionPalette";
import { LivesIndicator } from "./ChallengeMode";
import { useBookmarks } from "../../hooks/useBookmarks";
import { Markdown } from "../../utils/markdown";
import "./QuizPlayer.css";

interface Props {
  session: QuizSession;
  currentIdx: number;
  answers: Record<string, AnswerState>;
  /** Seconds remaining for the current question — can be negative (overtime). */
  timerRemaining: number;
  /** True iff the per-question timer option is enabled in the session config. */
  timerEnabled: boolean;
  /** Seconds remaining for the entire quiz (overall timer). */
  overallTimerRemaining: number;
  /** True iff the overall-timer option is enabled in the session config. */
  overallTimerEnabled: boolean;
  /** Lives configured at session start (0 = lives option disabled). */
  livesTotal: number;
  /** Lives still remaining. */
  livesRemaining: number;
  questionsAnswered: number;
  getQuestionStatus: (id: string) => QuestionStatus;
  onSelectAnswer: (questionId: string, optionId: string) => void;
  /** Multi-correct: replace the full set of selected option ids. */
  onSelectMultiple?: (questionId: string, optionIds: string[]) => void;
  /** Numerical: persist the user's typed value (number or null). */
  onSelectNumerical?: (questionId: string, value: number | null) => void;
  onToggleMark: (questionId: string) => void;
  onGoTo: (idx: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onSubmit: () => void;
}

export function QuizPlayer({
  session,
  currentIdx,
  answers,
  timerRemaining,
  timerEnabled,
  overallTimerRemaining,
  overallTimerEnabled,
  livesTotal,
  livesRemaining,
  questionsAnswered,
  getQuestionStatus,
  onSelectAnswer,
  onSelectMultiple,
  onSelectNumerical,
  onToggleMark,
  onGoTo,
  onNext,
  onPrev,
  onSubmit,
}: Props) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [enlargedDiagram, setEnlargedDiagram] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const bookmarks = useBookmarks();
  // Touched state so the bookmark icon re-renders immediately on tap.
  const [, setBookmarkRefresh] = useState(0);

  const { quiz } = session;
  const question = quiz.questions[currentIdx];
  if (!question) return null;

  const answer = answers[question.id];
  const selectedId = answer?.selectedOptionId ?? null;
  const selectedMultiIds = answer?.selectedOptionIds ?? [];
  const numericalValue = answer?.numericalAnswer ?? null;
  const total = quiz.questions.length;
  const isBookmarked = bookmarks.isBookmarked(quiz.id, question.id);
  const qtype: "single" | "multiple" | "numerical" = question.type ?? "single";

  // Draft for numerical input — allows typing without immediately firing the
  // parent's state update. We debounce the commit on blur / Enter.
  const [numericalDraft, setNumericalDraft] = useState<string>(
    numericalValue != null ? String(numericalValue) : "",
  );

  // Tally progress for the top progress bar + "X of Y answered" hint.
  // Must be type-aware: multi-correct is answered when selectedOptionIds is
  // non-empty; numerical when numericalAnswer is set.
  const progress = useMemo(() => {
    let answered = 0;
    let marked = 0;
    for (const a of Object.values(answers)) {
      if (a.selectedOptionId !== null) answered++;
      else if (Array.isArray(a.selectedOptionIds) && a.selectedOptionIds.length > 0) answered++;
      else if (a.numericalAnswer != null && a.numericalAnswer !== undefined) answered++;
      if (a.markedForReview) marked++;
    }
    return { answered, marked, total };
  }, [answers]);

  const handleToggleBookmark = useCallback(() => {
    bookmarks.toggleBookmark(quiz.id, question.id);
    setBookmarkRefresh((prev) => prev + 1);
  }, [bookmarks, quiz.id, question.id]);

  // When the user navigates to a new question, sync the numerical draft
  // from the existing answer (if any) or clear it.
  const prevIdxRef = useRef(currentIdx);
  useEffect(() => {
    if (prevIdxRef.current !== currentIdx) {
      prevIdxRef.current = currentIdx;
      const existingAnswer = answers[question.id];
      const newVal = existingAnswer?.numericalAnswer ?? null;
      setNumericalDraft(newVal != null ? String(newVal) : "");
    }
  }, [currentIdx, question.id, answers]);

  const commitNumericalDraft = useCallback(() => {
    if (!onSelectNumerical) return;
    const raw = numericalDraft.trim();
    if (raw === "") {
      onSelectNumerical(question.id, null);
      return;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      onSelectNumerical(question.id, parsed);
    }
  }, [onSelectNumerical, numericalDraft, question.id]);

  const handleSubmit = () => {
    if (!confirmSubmit) {
      setConfirmSubmit(true);
      return;
    }
    onSubmit();
  };

  // Speed mode is gone — Prev is just disabled on the first question.
  const disablePrev = currentIdx === 0;
  const isLast = currentIdx === total - 1;

  // Topic is intentionally NOT shown during the running quiz — revealing
  // it here would prime the student on which chapter/section this
  // question belongs to and defeat the purpose of using QuizForge as a
  // recall-strength test. Topics are shown in the Review screen after
  // the quiz ends so the student can group their mistakes by topic.

  return (
    <div className="quiz-player">
      {/* ── COMPACT TOP BAR ────────────────────────────────────────────── */}
      <header className="qp-topbar">
        <button
          type="button"
          className="qp-icon-btn qp-topbar__menu"
          onClick={() => setPaletteOpen(true)}
          aria-label={`Open question palette (${progress.answered} of ${total} answered)`}
        >
          <span aria-hidden="true">☰</span>
          <span className="qp-topbar__menu-count">
            {progress.answered}/{total}
          </span>
        </button>

        <div className="qp-topbar__center">
          <div className="qp-progress" aria-hidden="true">
            <div
              className="qp-progress__fill"
              style={{
                width: `${total ? (progress.answered / total) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="qp-topbar__meta">
            <span className="qp-topbar__counter">
              Q <strong>{currentIdx + 1}</strong>
              <span className="qp-topbar__counter-sep">/</span>
              {total}
            </span>
          </div>
        </div>

        <div className="qp-topbar__right">
          {overallTimerEnabled && (
            <span
              className="qp-overall-timer"
              title="Total quiz time remaining"
              role="timer"
              aria-live="polite"
            >
              <span className="qp-overall-timer__icon" aria-hidden="true">
                ⏳
              </span>
              <CountdownTimer remainingSeconds={overallTimerRemaining} />
            </span>
          )}
          {timerEnabled && (
            <CountdownTimer remainingSeconds={timerRemaining} />
          )}
          <LivesIndicator total={livesTotal} remaining={livesRemaining} />
        </div>
      </header>

      {/* ── MAIN QUESTION AREA ─────────────────────────────────────────── */}
      <main className="qp-body">
        <article className="qp-question-card">
          {/* card header: provenance badge only (topic is hidden during the
              running quiz and revealed in Review instead) */}
          <div className="qp-question-card__head">
            {question.sourceMode === "extracted" && (
              <span
                className="qp-source-chip qp-source-chip--extracted"
                title={
                  question.pageNumber != null
                    ? `Extracted from page ${question.pageNumber} of the source PDF`
                    : "Extracted from the source PDF"
                }
              >
                📄 From PDF
                {question.pageNumber != null ? ` · p${question.pageNumber}` : ""}
              </span>
            )}
            {question.sourceMode === "generated" && (
              <span
                className="qp-source-chip qp-source-chip--generated"
                title="Newly generated from the source material"
              >
                ✨ Generated
              </span>
            )}
            {/* Question-type chip — tells the student at a glance whether
                to pick one, pick many, or type a number. */}
            {qtype === "multiple" && (
              <span
                className="qp-source-chip qp-type-chip qp-type-chip--multiple"
                title="More than one option may be correct"
              >
                ☑ Select all
              </span>
            )}
            {qtype === "numerical" && (
              <span
                className="qp-source-chip qp-type-chip qp-type-chip--numerical"
                title="Type a numeric answer"
              >
                🔢 Numerical
              </span>
            )}
            <button
              type="button"
              className={`qp-bookmark-btn${isBookmarked ? " qp-bookmark-btn--active" : ""}`}
              onClick={handleToggleBookmark}
              aria-pressed={isBookmarked}
              aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this question"}
              title={isBookmarked ? "Remove bookmark" : "Bookmark"}
            >
              {isBookmarked ? "★" : "☆"}
            </button>
          </div>

          {/* prompt — full text wraps, no truncation */}
          <div className="qp-prompt"><Markdown source={question.prompt} /></div>

          {/* diagrams — stacked, tappable */}
          {question.diagramIds.length > 0 && (
            <div className="qp-diagrams">
              {question.diagramIds.map((dId) => {
                const diagram = quiz.diagrams[dId];
                const imageData =
                  diagram?.imageData ??
                  (diagram as unknown as { image_data?: string })?.image_data;
                if (!diagram || !imageData) return null;
                return (
                  <button
                    key={dId}
                    type="button"
                    className="qp-diagram-btn"
                    onClick={() => setEnlargedDiagram(dId)}
                    aria-label="Tap to enlarge diagram"
                  >
                    <img
                      src={`data:image/png;base64,${imageData}`}
                      alt={`Diagram for question ${currentIdx + 1}`}
                      className="qp-diagram-img"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </article>

        {/* ── OPTIONS (or NUMERICAL INPUT) ──────────────────────────────── */}
        {qtype === "numerical" ? (
          <div className="qp-numerical" role="group" aria-label="Numerical answer">
            <label htmlFor={`num-input-${question.id}`} className="qp-numerical__label">
              Enter your answer:
            </label>
            <input
              id={`num-input-${question.id}`}
              type="number"
              inputMode="decimal"
              className="qp-numerical__input"
              placeholder="Type your answer here"
              value={numericalDraft}
              onChange={(e) => setNumericalDraft(e.target.value)}
              onBlur={commitNumericalDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitNumericalDraft();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label="Numeric answer"
            />
            {numericalValue != null && (
              <span className="qp-numerical__preview">
                Submitted: <strong>{numericalValue}</strong>
              </span>
            )}
          </div>
        ) : qtype === "multiple" ? (
          <div
            className="qp-options"
            role="group"
            aria-label="Answer options (select all that apply)"
          >
            {question.options.filter((o) => o.text !== "").map((opt) => {
              const isSelected = selectedMultiIds.includes(opt.id);
              const handleMultiToggle = () => {
                if (!onSelectMultiple) return;
                const next = isSelected
                  ? selectedMultiIds.filter((id) => id !== opt.id)
                  : [...selectedMultiIds, opt.id];
                onSelectMultiple(question.id, next);
              };
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`qp-option${isSelected ? " qp-option--selected" : ""}`}
                  onClick={handleMultiToggle}
                  role="checkbox"
                  aria-checked={isSelected}
                >
                  <span className="qp-option__id">{opt.id}</span>
                  <span className="qp-option__text"><Markdown source={opt.text} /></span>
                  <span
                    className={`qp-option__check${isSelected ? " qp-option__check--on" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <div
            className="qp-options"
            role="radiogroup"
            aria-label="Answer options"
          >
            {question.options.filter((o) => o.text !== "").map((opt) => {
              const isSelected = selectedId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`qp-option${isSelected ? " qp-option--selected" : ""}`}
                  onClick={() => onSelectAnswer(question.id, opt.id)}
                  role="radio"
                  aria-checked={isSelected}
                >
                  <span className="qp-option__id">{opt.id}</span>
                  <span className="qp-option__text"><Markdown source={opt.text} /></span>
                  <span
                    className={`qp-option__check${isSelected ? " qp-option__check--on" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* ── STICKY BOTTOM NAV ─────────────────────────────────────────── */}
      <nav className="qp-bottombar" aria-label="Question navigation">
        <button
          type="button"
          className={`qp-bottombar__btn qp-bottombar__btn--ghost${answer?.markedForReview ? " is-marked" : ""}`}
          onClick={() => onToggleMark(question.id)}
          aria-pressed={!!answer?.markedForReview}
          aria-label={
            answer?.markedForReview ? "Remove mark for review" : "Mark for review"
          }
        >
          <span aria-hidden="true">{answer?.markedForReview ? "★" : "☆"}</span>
          <span className="qp-bottombar__btn-label">
            {answer?.markedForReview ? "Marked" : "Mark"}
          </span>
        </button>

        <div className="qp-bottombar__nav">
          <button
            type="button"
            className="qp-bottombar__nav-btn"
            onClick={onPrev}
            disabled={disablePrev}
            aria-label="Previous question"
          >
            <span aria-hidden="true">←</span>
            <span>Prev</span>
          </button>
          {!isLast ? (
            <button
              type="button"
              className="qp-bottombar__nav-btn qp-bottombar__nav-btn--primary"
              onClick={onNext}
              aria-label="Next question"
            >
              <span>Next</span>
              <span aria-hidden="true">→</span>
            </button>
          ) : (
            <button
              type="button"
              className="qp-bottombar__nav-btn qp-bottombar__nav-btn--primary"
              onClick={handleSubmit}
            >
              <span>Submit</span>
              <span aria-hidden="true">✓</span>
            </button>
          )}
        </div>
      </nav>

      {/* ── CONFIRM SUBMIT MODAL ──────────────────────────────────────── */}
      {confirmSubmit && (
        <div
          className="qp-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm submission"
          onClick={() => setConfirmSubmit(false)}
        >
          <div
            className="qp-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="qp-modal-card__title">Submit quiz?</h2>
            <p className="qp-modal-card__body">
              You've answered{" "}
              <strong>{progress.answered}</strong> of{" "}
              <strong>{total}</strong> questions
              {progress.marked > 0 && (
                <>
                  {" "}and marked{" "}
                  <strong>{progress.marked}</strong> for review
                </>
              )}
              .
            </p>
            {progress.answered < total && (
              <p className="qp-modal-card__warn">
                {total - progress.answered} question
                {total - progress.answered === 1 ? "" : "s"} left
                unanswered.
              </p>
            )}
            <div className="qp-modal-card__actions">
              <button
                type="button"
                className="qp-btn qp-btn--ghost"
                onClick={() => setConfirmSubmit(false)}
              >
                Keep going
              </button>
              <button
                type="button"
                className="qp-btn qp-btn--primary"
                onClick={onSubmit}
                autoFocus
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ENLARGED DIAGRAM ──────────────────────────────────────────── */}
      {enlargedDiagram && (
        <div
          className="qp-diagram-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged diagram"
          onClick={() => setEnlargedDiagram(null)}
        >
          {(() => {
            const overlayDiagram = quiz.diagrams[enlargedDiagram];
            const overlayData =
              overlayDiagram?.imageData ??
              (overlayDiagram as unknown as { image_data?: string })
                ?.image_data;
            if (!overlayData) return null;
            return (
              <img
                src={`data:image/png;base64,${overlayData}`}
                alt="Enlarged diagram"
                className="qp-diagram-overlay__img"
              />
            );
          })()}
          <button
            type="button"
            className="qp-diagram-overlay__close"
            onClick={() => setEnlargedDiagram(null)}
            aria-label="Close diagram"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── QUESTION PALETTE (drawer on all sizes) ────────────────────── */}
      <QuestionPalette
        total={total}
        currentIdx={currentIdx}
        getStatus={getQuestionStatus}
        questionIds={quiz.questions.map((q) => q.id)}
        questions={quiz.questions}
        onSelect={onGoTo}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}