import { useEffect, useRef, useMemo } from "react";
import type { QuestionStatus, Question } from "../../types";
import "./QuestionPalette.css";

interface Props {
  total: number;
  currentIdx: number;
  getStatus: (questionId: string) => QuestionStatus;
  questionIds: string[];
  questions?: Question[];
  onSelect: (idx: number) => void;
  open: boolean;
  onClose: () => void;
}

// Stable color per topic (so the same topic always gets the same color).
const TOPIC_COLORS = [
  "#f59e0b", "#22c55e", "#3b82f6", "#ef4444", "#a78bfa",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

function getTopicColor(topic: string, topicList: string[]): string {
  const idx = topicList.indexOf(topic);
  return TOPIC_COLORS[idx % TOPIC_COLORS.length]!;
}

export function QuestionPalette({
  total,
  currentIdx,
  getStatus,
  questionIds,
  questions,
  onSelect,
  open,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Extract unique topics for the topic legend.
  const topics = useMemo(() => {
    if (!questions) return [];
    const topicSet = new Set<string>();
    for (const q of questions) {
      const topic = (q as Question & { topic?: string }).topic;
      if (topic) topicSet.add(topic);
    }
    return Array.from(topicSet).sort();
  }, [questions]);

  // Focus trap + Esc-to-close while drawer is open.
  useEffect(() => {
    if (!open || !panelRef.current) return;

    const panel = panelRef.current;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    focusable[0]?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Lock body scroll while open so the page behind doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const statusLabel = (s: QuestionStatus): string => {
    switch (s) {
      case "answered":
        return "Answered";
      case "markedForReview":
        return "Marked for review";
      case "answeredAndMarked":
        return "Answered and marked";
      default:
        return "Unanswered";
    }
  };

  const answeredCount = useMemo(() => {
    let n = 0;
    for (const id of questionIds) {
      if (getStatus(id) !== "unanswered") n++;
    }
    return n;
  }, [questionIds, getStatus]);

  return (
    <>
      {/* Single drawer — works on desktop AND mobile. */}
      <div
        className={`palette-drawer${open ? " palette-drawer--open" : ""}`}
        role="dialog"
        aria-label="Question palette"
        aria-modal="true"
        ref={panelRef}
      >
        <div className="palette-drawer__header">
          <div className="palette-drawer__title-block">
            <h3 className="palette-drawer__title">Questions</h3>
            <p className="palette-drawer__subtitle">
              {answeredCount} of {total} answered
            </p>
          </div>
          <button
            type="button"
            className="palette-drawer__close"
            onClick={onClose}
            aria-label="Close question palette"
          >
            ✕
          </button>
        </div>

        {/* status legend */}
        <div className="palette-legend">
          <span className="palette-legend__item">
            <span className="palette-legend__dot palette-legend__dot--unanswered" />
            Unanswered
          </span>
          <span className="palette-legend__item">
            <span className="palette-legend__dot palette-legend__dot--answered" />
            Answered
          </span>
          <span className="palette-legend__item">
            <span className="palette-legend__dot palette-legend__dot--marked" />
            Marked
          </span>
          <span className="palette-legend__item">
            <span className="palette-legend__dot palette-legend__dot--answeredAndMarked" />
            Both
          </span>
        </div>

        {/* topic legend — compact chips */}
        {topics.length > 0 && (
          <div className="palette-legend palette-legend--topics">
            {topics.map((t) => (
              <span key={t} className="palette-topic-chip">
                <span
                  className="palette-legend__dot"
                  style={{ background: getTopicColor(t, topics) }}
                />
                {t}
              </span>
            ))}
          </div>
        )}

        {/* question grid */}
        <div
          className="palette__grid"
          role="group"
          aria-label="Question navigation"
        >
          {questionIds.map((id, idx) => {
            const status = getStatus(id);
            const question = questions?.[idx];
            const topic = (question as (Question & { topic?: string }) | undefined)?.topic;
            const topicColor =
              topic && topics.length > 0
                ? getTopicColor(topic, topics)
                : undefined;

            return (
              <button
                key={id}
                type="button"
                className={`palette__btn palette__btn--${status}${idx === currentIdx ? " palette__btn--current" : ""}`}
                onClick={() => {
                  onSelect(idx);
                  onClose();
                }}
                aria-label={`Question ${idx + 1}. ${statusLabel(status)}${idx === currentIdx ? ". Current question." : ""}`}
                aria-current={idx === currentIdx ? "step" : undefined}
                style={
                  topicColor
                    ? ({
                        ["--topic-color" as string]: topicColor,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Backdrop */}
      <div
        className={`palette-backdrop${open ? " palette-backdrop--visible" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
    </>
  );
}