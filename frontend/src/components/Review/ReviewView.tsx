import { useState, useMemo } from "react";
import type { QuizSession, Question } from "../../types";
import { SolutionPanel } from "./SolutionPanel";
import { QuestionChat } from "../Chat/QuestionChat";
import { useBookmarks } from "../../hooks/useBookmarks";
import { isAnswerCorrect } from "../../hooks/isAnswerCorrect";
import {
  isSaved as isNotebookSaved,
  saveQuestion as saveQuestionToNotebook,
  removeEntry as removeNotebookEntry,
} from "../../utils/notebook";
import { Markdown } from "../../utils/markdown";
import "./ReviewView.css";

interface Props {
  session: QuizSession;
  onNewQuiz: () => void;
  /** Called after every notebook add/remove so the header badge can re-read. */
  onNotebookChanged?: () => void;
  /** Called when the user clicks the "Open notebook" shortcut. */
  onOpenNotebook?: () => void;
}

export function ReviewView({
  session,
  onNewQuiz,
  onNotebookChanged,
  onOpenNotebook,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showChat, setShowChat] = useState<string | null>(null);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [topicFilter, setTopicFilter] = useState<string>("all");
  // Bumped after every notebook add/remove so each card re-evaluates
  // isSaved() with the latest localStorage state.
  const [notebookVersion, setNotebookVersion] = useState(0);
  const bookmarks = useBookmarks();

  const { quiz, answers } = session;

  // Extract unique topics
  const topics = useMemo(() => {
    const topicSet = new Set<string>();
    for (const q of quiz.questions) {
      const topic = (q as Question & { topic?: string }).topic;
      if (topic) topicSet.add(topic);
    }
    return Array.from(topicSet).sort();
  }, [quiz.questions]);

  // Filter questions
  const filteredQuestions = useMemo(() => {
    return quiz.questions.filter((q) => {
      if (showBookmarksOnly && !bookmarks.isBookmarked(quiz.id, q.id)) {
        return false;
      }
      if (topicFilter !== "all") {
        const topic = (q as Question & { topic?: string }).topic;
        if (topic !== topicFilter) return false;
      }
      return true;
    });
  }, [quiz.questions, quiz.id, showBookmarksOnly, topicFilter, bookmarks]);

  const getVerdict = (q: Question) => {
    const answer = answers[q.id];
    if (!answer) return "unanswered" as const;
    const correct = isAnswerCorrect(
      q,
      answer.selectedOptionId,
      answer.numericalAnswer ?? undefined,
    );
    if (correct === null) return "unanswered" as const;
    if (correct) return "correct" as const;
    return "incorrect" as const;
  };

  const verdictIcon = (v: "correct" | "incorrect" | "unanswered") => {
    switch (v) {
      case "correct":
        return <span className="review__verdict review__verdict--correct" aria-label="Correct">✓</span>;
      case "incorrect":
        return <span className="review__verdict review__verdict--incorrect" aria-label="Incorrect">✗</span>;
      case "unanswered":
        return <span className="review__verdict review__verdict--unanswered" aria-label="Unanswered">○</span>;
    }
  };

  const optionText = (q: Question, optId: string) =>
    q.options.find((o) => o.id === optId)?.text ?? optId;

  // Format seconds as M:SS (or just :SS if < 60).
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  /**
   * Render the per-question time pill shown in the review row.
   * Returns null if the per-question timer wasn't enabled.
   */
  const renderTimePill = (qid: string) => {
    if (!session.config.timePerQuestion.enabled) return null;
    const ans = answers[qid];
    if (!ans || typeof ans.timeSpentSec !== "number") return null;
    const allowed = session.config.timePerQuestion.durationMinutes * 60;
    const overtime = ans.wentOvertime === true;
    return (
      <span
        className={`review__time-pill ${overtime ? "review__time-pill--overtime" : ""}`}
        title={
          overtime
            ? `Solved past the ${formatTime(allowed)} limit`
            : "Time taken"
        }
      >
        ⏱ {formatTime(ans.timeSpentSec)}
        {overtime && <span className="review__time-overtime-tag"> overtime</span>}
      </span>
    );
  };

  /** Toggle the question's presence in the notebook. */
  const toggleNotebook = (qid: string) => {
    const question = quiz.questions.find((q) => q.id === qid);
    if (!question) return;
    if (isNotebookSaved(quiz.id, qid)) {
      removeNotebookEntry(`${quiz.id}:${qid}`);
    } else {
      saveQuestionToNotebook(quiz, question);
    }
    setNotebookVersion((v) => v + 1);
    onNotebookChanged?.();
  };

  return (
    <div className="review">
      <div className="container container--wide">
        <div className="review__header">
          <h1 className="review__title">Review</h1>
          <div className="review__header-actions">
            {onOpenNotebook && (
              <button
                className="btn-ghost review__open-notebook-btn"
                onClick={onOpenNotebook}
                aria-label="Open notebook"
              >
                📓 Notebook
              </button>
            )}
            <button className="btn-secondary" onClick={onNewQuiz}>
              New Quiz
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="review__filters">
          <label className="review__filter-toggle">
            <input
              type="checkbox"
              checked={showBookmarksOnly}
              onChange={(e) => setShowBookmarksOnly(e.target.checked)}
              className="review__filter-checkbox"
            />
            <span className="review__filter-label">★ Bookmarked only</span>
          </label>

          {topics.length > 0 && (
            <select
              className="review__topic-filter"
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              aria-label="Filter by topic"
            >
              <option value="all">All Topics</option>
              {topics.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>

        <div className="review__list">
          {filteredQuestions.length === 0 && (
            <div className="review__empty card">
              <p>
                {showBookmarksOnly
                  ? "No bookmarked questions found."
                  : "No questions match the selected filter."}
              </p>
            </div>
          )}

          {filteredQuestions.map((q) => {
            const originalIdx = quiz.questions.indexOf(q);
            const verdict = getVerdict(q);
            const answer = answers[q.id];
            const isExpanded = expandedId === q.id;
            const isBookmarked = bookmarks.isBookmarked(quiz.id, q.id);
            const topic = (q as Question & { topic?: string }).topic;

            return (
              <div
                key={q.id}
                className={`review__item card review__item--${verdict} ${isBookmarked ? "review__item--bookmarked" : ""}`}
              >
                <button
                  className="review__item-header"
                  onClick={() => setExpandedId(isExpanded ? null : q.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="review__item-num">
                    {verdictIcon(verdict)}
                    <span className="review__item-idx">{originalIdx + 1}</span>
                  </span>
                  <span className="review__item-prompt"><Markdown source={q.prompt} /></span>
                  {isBookmarked && <span className="review__item-bookmark-icon">★</span>}
                  {topic && <span className="review__item-topic">{topic}</span>}
                  {isNotebookSaved(quiz.id, q.id) && (
                    <span
                      className="review__notebook-indicator"
                      title="Saved in your notebook"
                      aria-label="In notebook"
                      data-version={notebookVersion}
                    >
                      📓
                    </span>
                  )}
                  {renderTimePill(q.id)}
                  <span className="review__item-chevron" aria-hidden="true">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="review__item-details">
                    {/* Diagrams */}
                    {q.diagramIds.length > 0 && (
                      <div className="review__diagrams">
                        {q.diagramIds.map((dId) => {
                          const diagram = quiz.diagrams[dId];
                          if (!diagram) return null;
                          return (
                            <img
                              key={dId}
                              src={`data:image/png;base64,${diagram.imageData}`}
                              alt={`Diagram for question ${originalIdx + 1}`}
                              className="review__diagram"
                            />
                          );
                        })}
                      </div>
                    )}

                    {/* Options / numerical answer — type-aware */}
                    {(q.type ?? "single") === "numerical" ? (
                      <div className="review__numerical">
                        <div className="review__numerical-row">
                          <span className="review__numerical-label">Your answer</span>
                          <span
                            className={`review__numerical-value ${answer?.numericalAnswer != null && verdict === "correct" ? "review__numerical-value--correct" : ""} ${answer?.numericalAnswer != null && verdict === "incorrect" ? "review__numerical-value--wrong" : ""}`}
                          >
                            {answer?.numericalAnswer != null
                              ? answer.numericalAnswer
                              : <em>(no answer)</em>}
                          </span>
                        </div>
                        <div className="review__numerical-row">
                          <span className="review__numerical-label">Correct answer</span>
                          <span className="review__numerical-value review__numerical-value--correct">
                            {q.numericalAnswer != null ? q.numericalAnswer : <em>(not provided)</em>}
                            {(q.numericalTolerance ?? 0) > 0 && (
                              <span className="review__numerical-tolerance">
                                {" "}± {q.numericalTolerance}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="review__options">
                        {q.options.filter((o) => o.text !== "").map((opt) => {
                          const qtype = q.type ?? "single";
                          const correctIds = qtype === "multiple"
                            ? (q.correctAnswerIds ?? [])
                            : [q.correctAnswerId];
                          const submittedIds = qtype === "multiple"
                            ? (answer?.selectedOptionIds ?? [])
                            : (answer?.selectedOptionId ? [answer.selectedOptionId] : []);
                          const isSubmitted = submittedIds.includes(opt.id);
                          const isCorrect = correctIds.includes(opt.id);
                          let cls = "review__option";
                          if (isCorrect) cls += " review__option--correct";
                          if (isSubmitted && !isCorrect) cls += " review__option--wrong";
                          return (
                            <div key={opt.id} className={cls}>
                              <span className="review__option-marker">
                                {qtype === "multiple"
                                  ? (isSubmitted ? "☑" : "☐")
                                  : (isCorrect ? "✓" : isSubmitted ? "✗" : "○")}
                              </span>
                              <span className="review__option-text"><Markdown source={opt.text} /></span>
                              {qtype === "multiple" && isSubmitted && !isCorrect && (
                                <span className="review__option-badge">Your pick</span>
                              )}
                              {isSubmitted && qtype === "single" && !isCorrect && (
                                <span className="review__option-badge">Your answer</span>
                              )}
                              {isCorrect && (
                                <span className="review__option-badge review__option-badge--correct">
                                  Correct
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {(q.type ?? "single") === "multiple" && (
                          <div className="review__multi-summary">
                            <strong>Needed:</strong>{" "}
                            {(q.correctAnswerIds ?? []).join(", ") || <em>(not provided)</em>}
                            {answer?.selectedOptionIds && answer.selectedOptionIds.length > 0 && (
                              <>
                                {" — "}
                                <strong>You picked:</strong>{" "}
                                {answer.selectedOptionIds.join(", ")}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="review__actions">
                      <SolutionPanel
                        question={q}
                        diagramMap={quiz.diagrams}
                      />
                      <button
                        className="btn-ghost review__chat-btn"
                        onClick={() => setShowChat(showChat === q.id ? null : q.id)}
                      >
                        💬 Ask Follow-up
                      </button>
                      <button
                        type="button"
                        className={`btn-secondary review__notebook-btn ${isNotebookSaved(quiz.id, q.id) ? "is-saved" : ""}`}
                        onClick={() => toggleNotebook(q.id)}
                        aria-pressed={isNotebookSaved(quiz.id, q.id)}
                        // Re-evaluate per render — version is unused in render
                        // but reading it ensures React re-checks isSaved.
                        data-version={notebookVersion}
                      >
                        {isNotebookSaved(quiz.id, q.id)
                          ? "✓ In notebook"
                          : "📓 Add to notebook"}
                      </button>
                    </div>

                    {showChat === q.id && (
                      <QuestionChat
                        question={q}
                        diagramMap={quiz.diagrams}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
