import { useState, useMemo } from "react";
import {
  groupBySubjectAndChapter,
  removeEntry,
  clearAll,
  type NotebookEntry,
} from "../../utils/notebook";
import { Markdown } from "../../utils/markdown";
import "./NotebookView.css";

interface Props {
  /** Live read of the notebook — caller re-reads from storage when this changes. */
  entries: NotebookEntry[];
  onBack: () => void;
  /** Called when the user removes an entry so the parent can re-load. */
  onChange: (next: NotebookEntry[]) => void;
}

/**
 * The user's saved-questions notebook. Browsable by subject → chapter.
 * Each entry can be expanded to show the question + options + answer, or
 * removed from the notebook. The header has a search box that filters
 * across prompts + topic text.
 */
export function NotebookView({ entries, onBack, onChange }: Props) {
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);

  const groups = useMemo(
    () => groupBySubjectAndChapter(entries),
    [entries],
  );

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        chapters: g.chapters
          .map((c) => ({
            ...c,
            entries: c.entries.filter(
              (e) =>
                e.prompt.toLowerCase().includes(q) ||
                e.topic.toLowerCase().includes(q) ||
                e.options.some((o) => o.text.toLowerCase().includes(q)),
            ),
          }))
          .filter((c) => c.entries.length > 0),
      }))
      .filter((g) => g.chapters.length > 0);
  }, [groups, query]);

  const totalCount = entries.length;

  const toggleSubject = (s: string) =>
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const toggleChapter = (key: string) =>
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleEntry = (id: string) =>
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleRemove = (id: string) => {
    const next = removeEntry(id);
    onChange(next);
  };

  const handleClearAll = () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    clearAll();
    onChange([]);
    setConfirmingClear(false);
  };

  return (
    <div className="notebook">
      <div className="container container--wide">
        <div className="notebook__header">
          <button className="btn-secondary" onClick={onBack}>
            ← Back
          </button>
          <h1 className="notebook__title">
            📓 Notebook
            <span className="notebook__count">
              {totalCount} {totalCount === 1 ? "question" : "questions"}
            </span>
          </h1>
          {totalCount > 0 && (
            <button
              className={`btn-ghost notebook__clear ${confirmingClear ? "notebook__clear--confirming" : ""}`}
              onClick={handleClearAll}
              onBlur={() => setConfirmingClear(false)}
              aria-label={
                confirmingClear
                  ? "Confirm clearing all notebook entries"
                  : "Clear notebook"
              }
            >
              {confirmingClear ? "Tap again to confirm" : "Clear all"}
            </button>
          )}
        </div>

        {totalCount === 0 ? (
          <div className="notebook__empty card">
            <p className="notebook__empty-headline">
              Your notebook is empty.
            </p>
            <p className="notebook__empty-body">
              After finishing a quiz, open the <strong>Review</strong> screen
              and tap <strong>📓 Add to notebook</strong> on any question you
              want to revisit. Questions are grouped by subject and chapter.
            </p>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="notebook__search">
              <input
                type="search"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search questions, topics, or options…"
                className="notebook__search-input"
                aria-label="Search notebook"
              />
              {query && (
                <button
                  type="button"
                  className="notebook__search-clear"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {filteredGroups.length === 0 ? (
              <div className="notebook__empty card">
                <p>
                  No questions match <strong>"{query}"</strong>.
                </p>
              </div>
            ) : (
              <div className="notebook__groups">
                {filteredGroups.map((g) => {
                  const subjectOpen = expandedSubjects.has(g.subject);
                  return (
                    <section
                      key={g.subject}
                      className={`notebook__subject ${subjectOpen ? "is-open" : ""}`}
                    >
                      <button
                        className="notebook__subject-header"
                        onClick={() => toggleSubject(g.subject)}
                        aria-expanded={subjectOpen}
                      >
                        <span className="notebook__chevron" aria-hidden="true">
                          {subjectOpen ? "▼" : "▶"}
                        </span>
                        <span className="notebook__subject-name">
                          {g.subject}
                        </span>
                        <span className="notebook__subject-meta">
                          {g.chapters.length}{" "}
                          {g.chapters.length === 1 ? "chapter" : "chapters"}
                          {" · "}
                          {g.totalCount}{" "}
                          {g.totalCount === 1 ? "question" : "questions"}
                        </span>
                      </button>

                      {subjectOpen && (
                        <div className="notebook__chapters">
                          {g.chapters.map((c) => {
                            const chapKey = `${g.subject}›${c.chapter}`;
                            const chapOpen = expandedChapters.has(chapKey);
                            return (
                              <section
                                key={chapKey}
                                className={`notebook__chapter ${chapOpen ? "is-open" : ""}`}
                              >
                                <button
                                  className="notebook__chapter-header"
                                  onClick={() => toggleChapter(chapKey)}
                                  aria-expanded={chapOpen}
                                >
                                  <span
                                    className="notebook__chevron"
                                    aria-hidden="true"
                                  >
                                    {chapOpen ? "▼" : "▶"}
                                  </span>
                                  <span className="notebook__chapter-name">
                                    {c.chapter}
                                  </span>
                                  <span className="notebook__chapter-meta">
                                    {c.entries.length}{" "}
                                    {c.entries.length === 1
                                      ? "question"
                                      : "questions"}
                                  </span>
                                </button>

                                {chapOpen && (
                                  <ol className="notebook__entries">
                                    {c.entries.map((e) => {
                                      const isOpen = expandedEntries.has(
                                        e.id,
                                      );
                                      return (
                                        <li
                                          key={e.id}
                                          className={`notebook__entry card ${isOpen ? "is-open" : ""}`}
                                        >
                                          <button
                                            className="notebook__entry-header"
                                            onClick={() => toggleEntry(e.id)}
                                            aria-expanded={isOpen}
                                          >
                                            <span
                                              className="notebook__chevron"
                                              aria-hidden="true"
                                            >
                                              {isOpen ? "▼" : "▶"}
                                            </span>
                                            <span className="notebook__entry-prompt">
                                              <Markdown source={e.prompt} />
                                            </span>
                                          </button>

                                          {isOpen && (
                                            <div className="notebook__entry-body">
                                              <ul className="notebook__entry-options">
                                                {e.options.map((o) => {
                                                  const isCorrect =
                                                    o.id ===
                                                    e.correctAnswerId;
                                                  return (
                                                    <li
                                                      key={o.id}
                                                      className={`notebook__entry-option ${isCorrect ? "is-correct" : ""}`}
                                                    >
                                                      <span className="notebook__entry-option-id">
                                                        {o.id}
                                                      </span>
                                                      <Markdown
                                                        source={o.text}
                                                      />
                                                      {isCorrect && (
                                                        <span className="notebook__entry-correct-tag">
                                                          ✓ correct
                                                        </span>
                                                      )}
                                                    </li>
                                                  );
                                                })}
                                              </ul>
                                              <div className="notebook__entry-meta">
                                                <span>
                                                  Saved{" "}
                                                  {new Date(
                                                    e.savedAt,
                                                  ).toLocaleDateString()}
                                                </span>
                                                {e.sourceMode ===
                                                  "extracted" && (
                                                  <span className="notebook__entry-provenance">
                                                    📄 From PDF
                                                    {e.pageNumber != null
                                                      ? ` · p${e.pageNumber}`
                                                      : ""}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="notebook__entry-actions">
                                                <button
                                                  type="button"
                                                  className="btn-ghost notebook__entry-remove"
                                                  onClick={() =>
                                                    handleRemove(e.id)
                                                  }
                                                  aria-label={`Remove question from notebook`}
                                                >
                                                  🗑 Remove
                                                </button>
                                              </div>
                                            </div>
                                          )}
                                        </li>
                                      );
                                    })}
                                  </ol>
                                )}
                              </section>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}