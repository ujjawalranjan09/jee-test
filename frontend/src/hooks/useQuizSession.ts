import { useState, useCallback, useRef, useEffect } from "react";
import type {
  Quiz,
  QuizSession,
  AnswerState,
  QuestionStatus,
  QuizConfig,
  Question,
} from "../types";
import { useTimer } from "./useTimer";
import { isAnswerCorrect, isQuestionAnswered } from "./isAnswerCorrect";

const CONFIG_KEY = "qf_quiz_config";

function defaultConfigSnapshot(): QuizConfig {
  // Avoid a circular import of the constant — re-declare the shape here.
  return {
    lives: { enabled: false, total: 3 },
    timePerQuestion: { enabled: false, durationMinutes: 2 },
    overallTime: { enabled: false, totalMinutes: 30 },
    generationMode: "generate",
  };
}

function loadConfig(): QuizConfig {
  // Always return a fully-formed QuizConfig. Every nested object is required
  // because the rest of the app reads `.enabled` on it unconditionally on
  // every render — a missing key would crash the QuizPlayer the moment
  // the user starts a quiz.
  try {
    const raw = sessionStorage.getItem(CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Defensive: fall back to defaults if a key is missing or wrong type.
    return {
      lives: {
        enabled: Boolean(parsed?.lives?.enabled),
        total:
          typeof parsed?.lives?.total === "number" &&
          parsed.lives.total >= 1 &&
          parsed.lives.total <= 99
            ? parsed.lives.total
            : 3,
      },
      timePerQuestion:
        typeof parsed?.timePerQuestion === "object" && parsed.timePerQuestion !== null
          ? {
              enabled: Boolean(parsed.timePerQuestion.enabled),
              durationMinutes:
                typeof parsed.timePerQuestion.durationMinutes === "number" &&
                [1, 2, 3, 4, 5, 6].includes(parsed.timePerQuestion.durationMinutes)
                  ? parsed.timePerQuestion.durationMinutes
                  : 2,
            }
          : { enabled: false, durationMinutes: 2 },
      overallTime:
        typeof parsed?.overallTime === "object" && parsed.overallTime !== null
          ? {
              enabled: Boolean(parsed.overallTime.enabled),
              totalMinutes:
                typeof parsed.overallTime.totalMinutes === "number" &&
                parsed.overallTime.totalMinutes >= 1 &&
                parsed.overallTime.totalMinutes <= 999
                  ? parsed.overallTime.totalMinutes
                  : 30,
            }
          : { enabled: false, totalMinutes: 30 },
      generationMode:
        parsed?.generationMode === "exact" ? "exact" : "generate",
    };
  } catch {
    return defaultConfigSnapshot();
  }
}

export function useQuizSession() {
  const [session, setSession] = useState<QuizSession | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [livesRemaining, setLivesRemaining] = useState(0);
  const [config, setConfigState] = useState<QuizConfig>(() => loadConfig());
  const [questionsAnswered, setQuestionsAnswered] = useState(0);

  // ── Per-question timer ────────────────────────────────────────────────
  // Always created (so callers can call `.start()` unconditionally) but
  // ticks only when `config.timePerQuestion.enabled` is true.
  const perQDuration =
    config.timePerQuestion.enabled && config.timePerQuestion.durationMinutes > 0
      ? config.timePerQuestion.durationMinutes * 60
      : 0;
  const timer = useTimer(perQDuration, config.timePerQuestion.enabled);

  // ── Overall quiz timer (separate hook instance, independent of per-Q) ─
  // Always created; ticks only when `config.overallTime.enabled`.
  const overallDuration =
    config.overallTime.enabled && config.overallTime.totalMinutes > 0
      ? config.overallTime.totalMinutes * 60
      : 0;
  const overallTimer = useTimer(overallDuration, config.overallTime.enabled);

  const submitCallbackRef = useRef<(() => void) | null>(null);
  // Mirror config + current quiz into refs so async callbacks always see
  // the latest values without requiring them in useCallback deps.
  const configRef = useRef<QuizConfig>(config);
  const quizRef = useRef<Quiz | null>(null);
  const currentIdxRef = useRef(0);

  // Keep refs in sync.
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const updateConfig = useCallback(
    (patch: Partial<QuizConfig>) => {
      // Merge patch onto current state. Without this, callers that pass a
      // partial object (e.g. `{ generationMode: "generate" }`) would replace
      // the entire config and silently drop `lives`, `timePerQuestion`, and
      // `overallTime` — which then crashes QuizPlayer on the next render with
      // "Cannot read properties of undefined (reading 'enabled')".
      setConfigState((prev) => {
        const next: QuizConfig = { ...prev, ...patch };
        try {
          sessionStorage.setItem(CONFIG_KEY, JSON.stringify(next));
        } catch {
          /* quota / privacy mode — non-fatal */
        }
        return next;
      });
    },
    [],
  );

  const startSession = useCallback(
    (quiz: Quiz, cfg: QuizConfig) => {
      const answers: Record<string, AnswerState> = {};
      for (const q of quiz.questions) {
        answers[q.id] = {
          questionId: q.id,
          selectedOptionId: null,
          markedForReview: false,
        };
      }

      try {
        sessionStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
      } catch {
        /* non-fatal */
      }
      setConfigState(cfg);
      configRef.current = cfg;

      const initialLives = cfg.lives.enabled ? cfg.lives.total : 0;
      setLivesRemaining(initialLives);
      setQuestionsAnswered(0);

      quizRef.current = quiz;
      currentIdxRef.current = 0;

      setSession({
        quiz,
        answers,
        config: cfg,
        startedAt: Date.now(),
        status: "in_progress",
      });
      setCurrentIdx(0);

      // Arm the per-question timer for question 0 if enabled.
      if (cfg.timePerQuestion.enabled) {
        timer.reset(cfg.timePerQuestion.durationMinutes * 60);
        timer.start();
      }
      // Arm the overall quiz timer if enabled.
      if (cfg.overallTime.enabled) {
        overallTimer.reset(cfg.overallTime.totalMinutes * 60);
        overallTimer.start();
      }
    },
    [timer, overallTimer],
  );

  /**
   * Centralized helper: captures the per-question elapsed time into the
   * AnswerState (and whether it went overtime). Called whenever the user
   * selects an answer OR the quiz ends without answering.
   */
  const freezeQuestionTime = useCallback(
    (
      answers: Record<string, AnswerState>,
      questionId: string,
    ): Record<string, AnswerState> => {
      if (!configRef.current.timePerQuestion.enabled) return answers;
      // Pull the latest elapsed from the timer.
      const elapsed = timer.elapsedOnFreeze;
      if (elapsed === undefined) return answers;
      const wentOver =
        elapsed > configRef.current.timePerQuestion.durationMinutes * 60;
      const existing = answers[questionId];
      if (!existing) return answers;
      return {
        ...answers,
        [questionId]: {
          ...existing,
          timeSpentSec: elapsed,
          wentOvertime: wentOver,
        },
      };
    },
    [timer],
  );

  const selectAnswer = useCallback(
    (questionId: string, optionId: string) => {
      setSession((prev) => {
        if (!prev || prev.status === "ended") return prev;
        const cfg = configRef.current;
        const existing = prev.answers[questionId];
        // Preserve the multi/numerical fields when the user later clicks a
        // single-correct option on a different question (legacy MCQ).
        const merged: AnswerState = {
          ...(existing ?? { questionId, selectedOptionId: null, markedForReview: false }),
          questionId,
          selectedOptionId: optionId,
          selectedOptionIds: undefined,
          numericalAnswer: undefined,
          markedForReview: existing?.markedForReview ?? false,
        };
        let nextAnswers: Record<string, AnswerState> = {
          ...prev.answers,
          [questionId]: merged,
        };

        // Freeze the per-question timer (if enabled) the moment they answer.
        if (cfg.timePerQuestion.enabled) {
          timer.stop();
          nextAnswers = freezeQuestionTime(nextAnswers, questionId);
        }

        return {
          ...prev,
          answers: nextAnswers,
        };
      });

      setQuestionsAnswered((prev) => prev + 1);

      // Lives: deduct when the answer is wrong (only if lives are enabled).
      if (configRef.current.lives.enabled) {
        const currentQuiz = quizRef.current;
        const question = currentQuiz?.questions.find((q) => q.id === questionId);
        if (question) {
          const isCorrect =
            optionId.trim().toLowerCase() ===
            (question.correctAnswerId || "").trim().toLowerCase();
          if (!isCorrect) {
            setLivesRemaining((prev) => {
              const next = prev - 1;
              if (next <= 0) {
                setTimeout(() => {
                  timer.stop();
                  overallTimer.stop();
                  submitCallbackRef.current?.();
                }, 300);
              }
              return next;
            });
          }
        }
      }
    },
    [timer, overallTimer, freezeQuestionTime],
  );

  /**
   * Multi-correct: replace the user's selection set for a question.
   * Called by QuizPlayer's checkbox group handler — passing the full new
   * array (not a delta) keeps the API simple and avoids race conditions
   * with batched state updates.
   */
  const selectMultipleAnswers = useCallback(
    (questionId: string, optionIds: string[]) => {
      setSession((prev) => {
        if (!prev || prev.status === "ended") return prev;
        const cfg = configRef.current;
        const existing = prev.answers[questionId];
        const merged: AnswerState = {
          ...(existing ?? { questionId, selectedOptionId: null, markedForReview: false }),
          questionId,
          selectedOptionId: null,
          selectedOptionIds: optionIds,
          numericalAnswer: undefined,
          markedForReview: existing?.markedForReview ?? false,
        };
        let nextAnswers: Record<string, AnswerState> = {
          ...prev.answers,
          [questionId]: merged,
        };
        if (cfg.timePerQuestion.enabled) {
          timer.stop();
          nextAnswers = freezeQuestionTime(nextAnswers, questionId);
        }
        return { ...prev, answers: nextAnswers };
      });

      setQuestionsAnswered((prev) => prev + 1);

      // Lives: all-or-nothing grading — wrong (or partial) = lose a life.
      if (configRef.current.lives.enabled) {
        const currentQuiz = quizRef.current;
        const question = currentQuiz?.questions.find((q) => q.id === questionId);
        if (question && !isAnswerCorrect(question, optionIds, undefined)) {
          setLivesRemaining((prev) => {
            const next = prev - 1;
            if (next <= 0) {
              setTimeout(() => {
                timer.stop();
                overallTimer.stop();
                submitCallbackRef.current?.();
              }, 300);
            }
            return next;
          });
        }
      }
    },
    [timer, overallTimer, freezeQuestionTime],
  );

  /**
   * Numerical: record the user's typed answer. Accepts a string (parsed
   * here) or number. null clears the answer.
   */
  const selectNumericalAnswer = useCallback(
    (questionId: string, value: number | string | null) => {
      const numeric = typeof value === "number"
        ? value
        : value === null || value === ""
          ? null
          : Number(value);
      const finalValue = numeric !== null && Number.isFinite(numeric) ? numeric : null;

      setSession((prev) => {
        if (!prev || prev.status === "ended") return prev;
        const cfg = configRef.current;
        const existing = prev.answers[questionId];
        const merged: AnswerState = {
          ...(existing ?? { questionId, selectedOptionId: null, markedForReview: false }),
          questionId,
          selectedOptionId: null,
          selectedOptionIds: undefined,
          numericalAnswer: finalValue,
          markedForReview: existing?.markedForReview ?? false,
        };
        let nextAnswers: Record<string, AnswerState> = {
          ...prev.answers,
          [questionId]: merged,
        };
        if (cfg.timePerQuestion.enabled) {
          timer.stop();
          nextAnswers = freezeQuestionTime(nextAnswers, questionId);
        }
        return { ...prev, answers: nextAnswers };
      });

      setQuestionsAnswered((prev) => prev + 1);

      // Lives: lose a life on a wrong numerical answer.
      if (configRef.current.lives.enabled) {
        const currentQuiz = quizRef.current;
        const question = currentQuiz?.questions.find((q) => q.id === questionId);
        if (question && !isAnswerCorrect(question, undefined, finalValue)) {
          setLivesRemaining((prev) => {
            const next = prev - 1;
            if (next <= 0) {
              setTimeout(() => {
                timer.stop();
                overallTimer.stop();
                submitCallbackRef.current?.();
              }, 300);
            }
            return next;
          });
        }
      }
    },
    [timer, overallTimer, freezeQuestionTime],
  );

  const toggleMarkForReview = useCallback((questionId: string) => {
    setSession((prev) => {
      if (!prev || prev.status === "ended") return prev;
      const existing = prev.answers[questionId];
      const merged: AnswerState = {
        questionId,
        selectedOptionId: existing?.selectedOptionId ?? null,
        markedForReview: !existing?.markedForReview,
      };
      return {
        ...prev,
        answers: {
          ...prev.answers,
          [questionId]: merged,
        },
      };
    });
  }, []);

  const getQuestionStatus = useCallback(
    (questionId: string): QuestionStatus => {
      if (!session) return "unanswered";
      const answer = session.answers[questionId];
      if (!answer) return "unanswered";
      // Look up the question so we can route by type. Default to "single"
      // for legacy questions without a type.
      const question = session.quiz.questions.find((q) => q.id === questionId);
      const answered = isQuestionAnswered(question ?? ({} as Question), answer);
      const marked = answer.markedForReview;
      if (answered && marked) return "answeredAndMarked";
      if (answered) return "answered";
      if (marked) return "markedForReview";
      return "unanswered";
    },
    [session],
  );

  const endSession = useCallback(() => {
    // Freeze both timers into the AnswerState so the review screen can show
    // how long was spent on the last question.
    timer.stop();
    overallTimer.stop();
    setSession((prev) => {
      if (!prev) return null;
      let answers = prev.answers;
      if (configRef.current.timePerQuestion.enabled) {
        const qid = prev.quiz.questions[currentIdxRef.current]?.id;
        if (qid) answers = freezeQuestionTime(answers, qid);
      }
      return { ...prev, answers, status: "ended" };
    });
  }, [timer, overallTimer, freezeQuestionTime]);

  const onSubmit = useCallback((cb: () => void) => {
    submitCallbackRef.current = cb;
  }, []);

  // Per-question expiry is purely informational now (we vibrate + show
  // negative time). It does NOT auto-submit or auto-advance.
  useEffect(() => {
    timer.onExpire(() => {
      // Intentionally empty — the user keeps answering or clicks Next.
      // We capture the negative elapsed via the next `stop()` or `endSession()`.
    });
  }, [timer]);

  // Overall quiz expiry: auto-submit (end the quiz + score).
  useEffect(() => {
    overallTimer.onExpire(() => {
      timer.stop();
      overallTimer.stop();
      submitCallbackRef.current?.();
    });
  }, [overallTimer, timer]);

  const goToQuestion = useCallback(
    (idx: number) => {
      if (idx === currentIdxRef.current) return;
      // Freeze the outgoing question's time so review can show it.
      if (configRef.current.timePerQuestion.enabled) {
        timer.stop();
        setSession((prev) => {
          if (!prev) return prev;
          const qid = prev.quiz.questions[currentIdxRef.current]?.id;
          if (!qid) return prev;
          return {
            ...prev,
            answers: freezeQuestionTime(prev.answers, qid),
          };
        });
      }
      currentIdxRef.current = idx;
      setCurrentIdx(idx);
      // Arm the per-question timer for the new question if enabled.
      // (The overall timer keeps running across questions.)
      if (configRef.current.timePerQuestion.enabled) {
        timer.reset(configRef.current.timePerQuestion.durationMinutes * 60);
        timer.start();
      }
    },
    [timer, freezeQuestionTime],
  );

  const nextQuestion = useCallback(() => {
    const total = session?.quiz.questions.length ?? 0;
    goToQuestion(Math.min(currentIdxRef.current + 1, Math.max(total - 1, 0)));
  }, [goToQuestion, session]);

  const prevQuestion = useCallback(() => {
    goToQuestion(Math.max(currentIdxRef.current - 1, 0));
  }, [goToQuestion]);

  return {
    session,
    currentIdx,
    timer,
    overallTimer,
    config,
    updateConfig,
    livesRemaining,
    questionsAnswered,
    startSession,
    selectAnswer,
    selectMultipleAnswers,
    selectNumericalAnswer,
    toggleMarkForReview,
    getQuestionStatus,
    endSession,
    goToQuestion,
    nextQuestion,
    prevQuestion,
    onSubmit,
  };
}
