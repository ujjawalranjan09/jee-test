import { useState, useEffect } from "react";
import type { QuizConfig } from "../../types";
import "./QuizOptions.css";

interface Props {
  config: QuizConfig;
  onChange: (next: QuizConfig) => void;
}

const LIFE_OPTIONS = [1, 2, 3, 5, 7, 10];
const TIME_OPTIONS = [1, 2, 3, 4, 5, 6];
const OVERALL_PRESETS = [5, 10, 15, 20, 30, 45, 60, 90];

/**
 * Independent quiz option toggles. Replaces the old "Challenge Mode" radio
 * (classic / speed / survival / marathon) — the user can now mix and match:
 *
 *   Lives              on/off + customizable default (chips + custom input)
 *   Time per question  on/off + duration picker (1, 2, 3, 4, 5, 6 min)
 *   Overall quiz time  on/off + typable minutes (any positive integer) +
 *                      quick-pick chips
 *   Question source    radio: "Exact from PDF" (verbatim extraction) vs
 *                      "Generate new" (LLM synthesised MCQs from the source)
 *
 * All toggles are independent — the user can enable any combination.
 */
export function QuizOptions({ config, onChange }: Props) {
  const [customLife, setCustomLife] = useState(String(config.lives.total));
  const [overallDraft, setOverallDraft] = useState(
    String(config.overallTime.totalMinutes),
  );
  const [overallError, setOverallError] = useState("");

  // Keep the local draft text in sync when the parent (e.g. sessionStorage
  // restore) changes the value out from under us.
  useEffect(() => {
    setCustomLife(String(config.lives.total));
  }, [config.lives.total]);
  useEffect(() => {
    setOverallDraft(String(config.overallTime.totalMinutes));
  }, [config.overallTime.totalMinutes]);

  const update = (patch: Partial<QuizConfig>) => {
    onChange({
      lives: { ...config.lives, ...(patch.lives ?? {}) },
      timePerQuestion: {
        ...config.timePerQuestion,
        ...(patch.timePerQuestion ?? {}),
      },
      overallTime: {
        ...config.overallTime,
        ...(patch.overallTime ?? {}),
      },
      generationMode: patch.generationMode ?? config.generationMode,
    });
  };

  const handleCustomLife = (raw: string) => {
    setCustomLife(raw);
    const num = parseInt(raw, 10);
    if (!isNaN(num) && num >= 1 && num <= 99) {
      update({ lives: { ...config.lives, total: num } });
    }
  };

  const handleOverallChange = (raw: string) => {
    setOverallDraft(raw);
    setOverallError("");
    const num = parseInt(raw, 10);
    if (isNaN(num) || num < 1) {
      setOverallError("Must be at least 1 minute");
      return;
    }
    if (num > 999) {
      setOverallError("Maximum is 999 minutes");
      return;
    }
    update({ overallTime: { ...config.overallTime, totalMinutes: num } });
  };

  const overallPreset = (n: number) => {
    setOverallError("");
    update({ overallTime: { ...config.overallTime, totalMinutes: n } });
  };

  const combosOn =
    [config.lives.enabled, config.timePerQuestion.enabled, config.overallTime.enabled]
      .filter(Boolean).length;

  return (
    <div className="quiz-options">
      <h2 className="quiz-options__title">Quiz Options</h2>
      <p className="quiz-options__hint">
        Mix and match — enable one, two, three, or none. Question source
        decides how the quiz is built from your PDF.
      </p>

      {/* ── QUESTION SOURCE (always shown — there's always a default) ─── */}
      <section className="quiz-options__row quiz-options__row--source">
        <label className="quiz-options__source-label">
          <span className="quiz-options__icon" aria-hidden="true">
            📑
          </span>
          Question source
        </label>
        <p className="quiz-options__desc">
          <strong>Exact from PDF</strong> pulls multiple-choice questions
          straight out of your document (with the answer if it's printed
          there). <strong>Generate new</strong> has the AI invent fresh MCQs
          on the same topics.
        </p>
        <div
          className="quiz-options__chips"
          role="radiogroup"
          aria-label="Question source"
        >
          <button
            type="button"
            className={`quiz-options__chip ${config.generationMode === "exact" ? "quiz-options__chip--active" : ""}`}
            onClick={() => update({ generationMode: "exact" })}
            role="radio"
            aria-checked={config.generationMode === "exact"}
          >
            📄 Exact from PDF
          </button>
          <button
            type="button"
            className={`quiz-options__chip ${config.generationMode === "generate" ? "quiz-options__chip--active" : ""}`}
            onClick={() => update({ generationMode: "generate" })}
            role="radio"
            aria-checked={config.generationMode === "generate"}
          >
            ✨ Generate new
          </button>
        </div>
      </section>

      {/* ── LIVES ─────────────────────────────────────────────────────── */}
      <section
        className={`quiz-options__row quiz-options__row--lives ${config.lives.enabled ? "quiz-options__row--on" : ""}`}
      >
        <label className="quiz-options__toggle">
          <input
            type="checkbox"
            checked={config.lives.enabled}
            onChange={(e) =>
              update({ lives: { ...config.lives, enabled: e.target.checked } })
            }
            className="quiz-options__checkbox"
            aria-describedby="quiz-options-lives-desc"
          />
          <span className="quiz-options__switch" aria-hidden="true" />
          <span className="quiz-options__label">
            <span className="quiz-options__icon" aria-hidden="true">
              ❤️
            </span>
            Lives
          </span>
        </label>

        <p id="quiz-options-lives-desc" className="quiz-options__desc">
          Wrong answer costs a life. Quiz ends when you run out.
        </p>

        {config.lives.enabled && (
          <div className="quiz-options__customize">
            <span className="quiz-options__customize-label">Starting lives</span>
            <div className="quiz-options__chips">
              {LIFE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`quiz-options__chip ${config.lives.total === n ? "quiz-options__chip--active" : ""}`}
                  onClick={() => {
                    update({ lives: { ...config.lives, total: n } });
                    setCustomLife(String(n));
                  }}
                  aria-pressed={config.lives.total === n}
                  aria-label={`${n} ${n === 1 ? "life" : "lives"}`}
                >
                  {n}
                </button>
              ))}
              <label className="quiz-options__custom">
                <span className="sr-only">Custom life count</span>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={1}
                  max={99}
                  value={customLife}
                  onChange={(e) => handleCustomLife(e.target.value)}
                  className="quiz-options__custom-input"
                  aria-label="Custom life count"
                  placeholder="Custom"
                />
              </label>
            </div>
          </div>
        )}
      </section>

      {/* ── TIME PER QUESTION ─────────────────────────────────────────── */}
      <section
        className={`quiz-options__row quiz-options__row--time ${config.timePerQuestion.enabled ? "quiz-options__row--on" : ""}`}
      >
        <label className="quiz-options__toggle">
          <input
            type="checkbox"
            checked={config.timePerQuestion.enabled}
            onChange={(e) =>
              update({
                timePerQuestion: {
                  ...config.timePerQuestion,
                  enabled: e.target.checked,
                },
              })
            }
            className="quiz-options__checkbox"
            aria-describedby="quiz-options-time-desc"
          />
          <span className="quiz-options__switch" aria-hidden="true" />
          <span className="quiz-options__label">
            <span className="quiz-options__icon" aria-hidden="true">
              ⏱️
            </span>
            Time per question
          </span>
        </label>

        <p id="quiz-options-time-desc" className="quiz-options__desc">
          At 0 the device vibrates and the timer keeps counting negative so you
          can see how long the question really took.
        </p>

        {config.timePerQuestion.enabled && (
          <div className="quiz-options__customize">
            <span className="quiz-options__customize-label">
              Minutes per question
            </span>
            <div
              className="quiz-options__chips"
              role="radiogroup"
              aria-label="Minutes per question"
            >
              {TIME_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`quiz-options__chip ${config.timePerQuestion.durationMinutes === m ? "quiz-options__chip--active" : ""}`}
                  onClick={() =>
                    update({
                      timePerQuestion: {
                        ...config.timePerQuestion,
                        durationMinutes: m,
                      },
                    })
                  }
                  role="radio"
                  aria-checked={
                    config.timePerQuestion.durationMinutes === m
                  }
                  aria-label={`${m} ${m === 1 ? "minute" : "minutes"} per question`}
                >
                  {m} {m === 1 ? "min" : "mins"}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── OVERALL QUIZ TIME (typable) ───────────────────────────────── */}
      <section
        className={`quiz-options__row quiz-options__row--overall ${config.overallTime.enabled ? "quiz-options__row--on" : ""}`}
      >
        <label className="quiz-options__toggle">
          <input
            type="checkbox"
            checked={config.overallTime.enabled}
            onChange={(e) =>
              update({
                overallTime: {
                  ...config.overallTime,
                  enabled: e.target.checked,
                },
              })
            }
            className="quiz-options__checkbox"
            aria-describedby="quiz-options-overall-desc"
          />
          <span className="quiz-options__switch" aria-hidden="true" />
          <span className="quiz-options__label">
            <span className="quiz-options__icon" aria-hidden="true">
              ⏳
            </span>
            Total quiz time
          </span>
        </label>

        <p id="quiz-options-overall-desc" className="quiz-options__desc">
          One timer for the whole quiz. When it hits 0 the quiz auto-submits.
          Type any number of minutes (1–999) — or pick a quick chip.
        </p>

        {config.overallTime.enabled && (
          <div className="quiz-options__customize">
            <span className="quiz-options__customize-label">
              Total minutes (typable)
            </span>
            <div className="quiz-options__customize-row">
              <label className="quiz-options__custom">
                <span className="sr-only">Total minutes</span>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={1}
                  max={999}
                  value={overallDraft}
                  onChange={(e) => handleOverallChange(e.target.value)}
                  className="quiz-options__custom-input quiz-options__custom-input--wide"
                  aria-label="Total quiz minutes"
                  placeholder="e.g. 45"
                />
                <span className="quiz-options__custom-suffix">min</span>
              </label>
            </div>
            <div
              className="quiz-options__chips"
              role="group"
              aria-label="Quick minute presets"
            >
              {OVERALL_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`quiz-options__chip ${config.overallTime.totalMinutes === m ? "quiz-options__chip--active" : ""}`}
                  onClick={() => overallPreset(m)}
                  aria-pressed={config.overallTime.totalMinutes === m}
                  aria-label={`${m} minutes`}
                >
                  {m} min
                </button>
              ))}
            </div>
            {overallError && (
              <p className="quiz-options__error" role="alert">
                {overallError}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Helpful combined-mode summary so the user can sanity-check. */}
      {combosOn >= 2 && (
        <p className="quiz-options__summary" role="status">
          ⚡ Combo enabled
          {config.lives.enabled && ` · ${config.lives.total} lives`}
          {config.timePerQuestion.enabled &&
            ` · ${config.timePerQuestion.durationMinutes} min per question`}
          {config.overallTime.enabled &&
            ` · ${config.overallTime.totalMinutes} min total`}
        </p>
      )}
    </div>
  );
}
