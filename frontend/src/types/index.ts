export interface Diagram {
  id: string;
  page: number;
  imageData: string;
  sourceFile?: string | null;
}

export interface QuestionOption {
  id: string;
  text: string;
}

/**
 * Question type — three supported shapes.
 *   "single"    : one correct option (radio button).  uses `correctAnswerId`
 *   "multiple"  : >1 correct option, all-or-nothing grading. uses `correctAnswerIds`
 *   "numerical" : integer / decimal answer, typed by the student. uses `numericalAnswer`
 *
 * Defaults to "single" when the field is absent (legacy quizzes).
 */
export type QuestionType = "single" | "multiple" | "numerical";

export interface Question {
  id: string;
  prompt: string;
  options: QuestionOption[];
  /** Defaults to "single" — see QuestionType for the full contract. */
  type?: QuestionType;
  /** Single-correct: the option letter (e.g. "B"). Empty if not provided. */
  correctAnswerId: string;
  /** Multi-correct: the list of option letters (e.g. ["B", "C"]). Empty if not provided. */
  correctAnswerIds?: string[];
  /** Numerical: the expected number. null if not provided. */
  numericalAnswer?: number | null;
  /**
   * Numerical: allowed absolute error. 0 (default) = exact match. Integer
   * answer papers can leave at 0; physics "approximate" questions may want
   * 0.01 or 0.1. Unused for single / multiple.
   */
  numericalTolerance?: number;
  diagramIds: string[];
  topic?: string;
  /**
   * Where this question came from:
   *   "extracted" = pulled verbatim from the source PDF (the "Exact"
   *                 generation mode). ``pageNumber`` is meaningful.
   *   "generated" = synthesised by the LLM from the source material.
   * Undefined for legacy quizzes that pre-date the field.
   */
  sourceMode?: "extracted" | "generated";
  /** Only meaningful when ``sourceMode === "extracted"``. */
  pageNumber?: number;
}

export interface Quiz {
  id: string;
  questions: Question[];
  diagrams: Record<string, Diagram>;
}

export type QuestionStatus =
  | "unanswered"
  | "answered"
  | "markedForReview"
  | "answeredAndMarked";

/**
 * Independent quiz configuration toggles.
 * These are NOT mutually exclusive — the user can enable any combination.
 *
 * - `lives`: a wrong answer costs a life. When lives hit 0 the quiz ends.
 *   Customizable count (default 3, range 1–10).
 * - `timePerQuestion`: each question gets its own countdown. At 0 the
 *   device vibrates and the timer keeps running negative ("overtime").
 *   The elapsed seconds are captured when the question is answered so
 *   the Review screen can show "+1:23 solved" / "+1:23 (overtime by 23s)".
 * - `overallTime`: a single shared countdown for the whole quiz. When it
 *   hits 0 the quiz auto-submits. Typable input (any positive integer).
 *   Independent from `timePerQuestion` — the user can enable either, both,
 *   or neither.
 * - `generationMode`: "exact" asks the LLM to extract MCQs verbatim from
 *   the PDF (cheaper; useful when practising an actual exam paper);
 *   "generate" asks the LLM to synthesise new MCQs from the source
 *   material (current default behaviour).
 */
export interface QuizConfig {
  lives: {
    enabled: boolean;
    total: number; // customizable default — 3 by default
  };
  timePerQuestion: {
    enabled: boolean;
    durationMinutes: number; // 1, 2, 3, 4, 5, or 6
  };
  overallTime: {
    enabled: boolean;
    /** Total minutes for the entire quiz (typable — any positive integer). */
    totalMinutes: number;
  };
  generationMode: "exact" | "generate";
}

export const DEFAULT_QUIZ_CONFIG: QuizConfig = {
  lives: { enabled: false, total: 3 },
  timePerQuestion: { enabled: false, durationMinutes: 2 },
  overallTime: { enabled: false, totalMinutes: 30 },
  generationMode: "generate",
};

export interface AnswerState {
  questionId: string;
  /**
   * Single-correct: the option id the user picked (e.g. "B"). null if
   * the question is unanswered, or if the question is multi/numerical
   * (those use the dedicated fields below).
   */
  selectedOptionId: string | null;
  /**
   * Multi-correct: the set of option ids the user selected.
   * Empty array if unanswered or if the question isn't multi-correct.
   * All-or-nothing grading is enforced by the backend.
   */
  selectedOptionIds?: string[];
  /**
   * Numerical: the number the user typed. null if unanswered or if the
   * question isn't numerical. Grading uses |user - expected| <= tolerance.
   */
  numericalAnswer?: number | null;
  markedForReview: boolean;
  /** Seconds spent on this question (frozen at answer time). undefined
   *  until the question is answered (or the session ends). When the
   *  per-question timer was enabled, this is the elapsed time INCLUDING
   *  any overtime past 0. */
  timeSpentSec?: number;
  /** True iff the user went past the per-question time limit. Used by the
   *  review screen to badge the time as "(overtime)". */
  wentOvertime?: boolean;
}

export interface QuizSession {
  quiz: Quiz;
  answers: Record<string, AnswerState>;
  /** Snapshot of the user's config at session start — so per-question
   *  time and lives can be rendered correctly in Review. */
  config: QuizConfig;
  /** Timestamp (ms since epoch) when the session was created. Used as a
   *  fallback for total quiz time when the per-question timer was off. */
  startedAt?: number;
  /** Whether the session was a fresh start vs. resumed from a share link. */
  status: "in_progress" | "ended";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Solution {
  questionId: string;
  solution: string;
}

export interface HealthResponse {
  status: string;
}

// Wire-format shapes — match the backend Pydantic schemas in
// backend/app/models/schemas.py. Keys are server-side now (env-configured),
// so these interfaces intentionally omit ``api_keys``.
export interface GenerateRequest {
  text: string;
  diagrams: Diagram[];
  num_questions?: number;
  difficulty?: string;
  focus_topics?: string[];
  question_types?: string[];
}

export interface SolveRequest {
  question: string;
  options: { id: string; text: string }[];
  diagrams?: Diagram[];
  /**
   * The answer the quiz generator originally marked as correct.
   *   - For single-correct MCQs, the option letter (e.g. "C").
   *   - For multi-correct MCQs, a comma-joined list (e.g. "B,C").
   *   - For numerical questions, the number as a string (e.g. "25" or "3.14").
   * Optional for backwards compat. When present, the backend will compare
   * it against the solver's answer and report a mismatch in
   * SolveResponse.answers_match — that's how we detect a hallucinated
   * answer from quiz generation.
   */
  correctAnswerId?: string;
  /** Question type controls the solver's answer-line format. Defaults to "single". */
  questionType?: QuestionType;
  /** Numerical: expected value, used by the cross-check. */
  numericalAnswer?: number | null;
  /** Numerical: tolerance for the cross-check (informational; solver doesn't use it). */
  numericalTolerance?: number;
}

export interface SolveResponse {
  solution?: string;
  error?: { error_type: string; message: string };
  /**
   * The answer the solver arrived at. Format depends on `questionType`:
   *   single    → letter (e.g. "D")
   *   multiple  → comma-joined letters (e.g. "B,C")
   *   numerical → number string (e.g. "25" or "3.14")
   * undefined if the solver didn't produce one.
   */
  parsed_answer?: string | null;
  /** Echo of the quiz's original claimed correct answer. */
  original_answer?: string | null;
  /** True iff both answers are present and they agree. */
  answers_match?: boolean | null;
}

export interface ChatRequest {
  question: string;
  options?: { id: string; text: string }[];
  diagrams?: Diagram[];
  messages: { role: "user" | "assistant"; content: string }[];
  message: string;
}
