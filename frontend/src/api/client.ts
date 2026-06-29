import type {
  HealthResponse,
  Quiz,
  Diagram,
  SolveRequest,
  ChatRequest,
} from "../types";

/**
 * Base URL for the backend API.
 *
 * Resolution order:
 *   1. `import.meta.env.VITE_API_URL` — set at build time. On Render this
 *      points at the deployed FastAPI service, e.g.
 *      "https://pdf-quiz-generator-backend.onrender.com".
 *   2. Same-origin `/api` — used in local development, where Vite's dev
 *      server proxies `/api/*` to `http://localhost:8000`.
 *
 * The trailing slash is stripped so path concatenation is consistent.
 */
const RAW_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "";
const BASE = RAW_BASE ? `${RAW_BASE}/api` : "/api";

/** Convert a diagram from the backend snake_case shape to the frontend camelCase shape.
 *  Accepts either camelCase or snake_case fields so it never silently drops an image. */
function normalizeDiagram(d: any): Diagram {
  const imageData: string | undefined =
    d?.imageData ?? d?.image_data ?? undefined;
  return {
    id: d.id,
    page: d.page,
    imageData: imageData ?? "",
    sourceFile: d.sourceFile ?? d.source_file ?? null,
  };
}

/** Normalize a Question from the backend's snake_case wire format to the
 *  frontend's camelCase shape. Used both for the unwrapped quiz from
 *  /quiz/generate and for any other code path that consumes Question
 *  objects directly. Defensive: every array field gets a safe default.
 *
 *  Handles all three question types (single / multiple / numerical) plus
 *  the legacy single-only shape. */
function normalizeQuestion(q: any): import("../types").Question {
  const sourceModeRaw = q?.sourceMode ?? q?.source_mode;
  const sourceMode: "extracted" | "generated" | undefined =
    sourceModeRaw === "extracted" || sourceModeRaw === "generated"
      ? sourceModeRaw
      : undefined;
  const pageNumRaw = q?.pageNumber ?? q?.page_number;
  const pageNumber: number | undefined =
    typeof pageNumRaw === "number" ? pageNumRaw : undefined;

  // Question type — backend may omit or alias.
  const typeRaw = q?.type;
  let type: import("../types").QuestionType | undefined;
  if (typeRaw === "single" || typeRaw === "multiple" || typeRaw === "numerical") {
    type = typeRaw;
  } else if (
    typeRaw === "multi" || typeRaw === "multi-select" || typeRaw === "select_all"
  ) {
    type = "multiple";
  } else if (
    typeRaw === "number" || typeRaw === "numeric" || typeRaw === "integer" ||
    typeRaw === "decimal" || typeRaw === "float"
  ) {
    type = "numerical";
  }

  // Per-type correct-answer fields — read whichever the backend sent and
  // normalise to the right camelCase field. If the LLM dropped the type
  // field, fall back to: numericalAnswer set → numerical, correctAnswerIds
  // set → multiple, else → single.
  const correctAnswerId: string =
    q?.correctAnswerId ?? q?.correct_answer_id ?? "";
  const correctAnswerIds: string[] | undefined = Array.isArray(q?.correctAnswerIds)
    ? q.correctAnswerIds
    : Array.isArray(q?.correct_answer_ids)
      ? q.correct_answer_ids
      : undefined;
  const numericalAnswerRaw = q?.numericalAnswer ?? q?.numerical_answer;
  const numericalAnswer: number | null | undefined =
    typeof numericalAnswerRaw === "number" ? numericalAnswerRaw : undefined;
  const numericalToleranceRaw =
    q?.numericalTolerance ?? q?.numerical_tolerance ?? 0;
  const numericalTolerance: number =
    typeof numericalToleranceRaw === "number" ? numericalToleranceRaw : 0;

  // If the backend omitted `type`, infer it from the fields that ARE set.
  if (!type) {
    if (numericalAnswer != null) type = "numerical";
    else if (correctAnswerIds && correctAnswerIds.length > 0) type = "multiple";
    else type = "single";
  }

  const out: any = {
    prompt: q?.prompt ?? "",
    options: Array.isArray(q?.options) ? q.options : [],
    type,
    correctAnswerId,
    correctAnswerIds,
    numericalAnswer,
    numericalTolerance,
    diagramIds: Array.isArray(q?.diagramIds)
      ? q.diagramIds
      : Array.isArray(q?.diagram_ids)
        ? q.diagram_ids
        : [],
    topic: q?.topic,
    sourceMode,
    pageNumber,
  };
  // Only set `id` when the input actually has one — so a totally malformed
  // backend response (or an empty array element) doesn't crash the renderer
  // by injecting a literal `undefined` id that React then complains about.
  if (typeof q?.id === "string") out.id = q.id;
  return out as import("../types").Question;
}

/** Normalize a full Quiz object so every nested shape is in the
 *  frontend's camelCase form. */
function normalizeQuiz(input: any): import("../types").Quiz {
  const diagramsInput = input?.diagrams ?? {};
  const normalizedDiagrams: Record<string, Diagram> = {};
  if (Array.isArray(diagramsInput)) {
    for (const d of diagramsInput) {
      if (d?.id) normalizedDiagrams[d.id] = normalizeDiagram(d);
    }
  } else if (typeof diagramsInput === "object") {
    for (const [id, d] of Object.entries(diagramsInput)) {
      normalizedDiagrams[id] = normalizeDiagram({ ...(d as object), id });
    }
  }
  return {
    id: input.id,
    questions: Array.isArray(input.questions)
      ? input.questions.map(normalizeQuestion)
      : [],
    diagrams: normalizedDiagrams,
  };
}

/**
 * Normalize whatever the backend returned into a Diagram[].
 * Backend may return a dict keyed by id (single upload) or an array (multi
 * upload) — and fields may be snake_case or camelCase depending on the
 * Pydantic config. Be defensive on every shape.
 */
function normalizeDiagrams(input: unknown): Diagram[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(normalizeDiagram);
  if (typeof input === "object") return Object.values(input as Record<string, any>).map(normalizeDiagram);
  return [];
}

/**
 * Test-only exports. Lets the vitest suite exercise the wire-format
 * normalizer directly instead of mocking the API. Not part of the
 * runtime contract — never import from app code.
 */
export const __test__normalizeQuestion = normalizeQuestion;
export const __test__normalizeQuiz = normalizeQuiz;

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
    });

    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        msg = body.detail ?? body.message ?? msg;
      } catch {
        // ignore parse error
      }
      throw new ApiError(res.status, msg);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health", {}, 15_000);
}

export async function uploadPdf(
  file: File,
): Promise<{
  text: string;
  diagrams: Diagram[];
  pages: string[];
  pageLayouts: unknown[];
}> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try {
      const body = await res.json();
      msg = body.detail ?? body.message ?? msg;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, msg);
  }

  const raw = await res.json();
  // Backend returns {text, diagrams: {id: Diagram}, pages: string[],
  // page_layouts: [{page_number, question_ys, figure_ys}, ...]}.
  // Pass all four through — page_layouts is consumed by the extract
  // endpoint to assign each figure to the right question by Y-position.
  return {
    text: raw.text ?? "",
    diagrams: normalizeDiagrams(raw.diagrams),
    pages: Array.isArray(raw.pages) ? raw.pages : [],
    pageLayouts: Array.isArray(raw.page_layouts) ? raw.page_layouts : [],
  };
}

export async function uploadMultiplePdfs(
  files: File[],
): Promise<{ text: string; diagrams: Diagram[] }> {
  const form = new FormData();
  for (const f of files) {
    form.append("files", f);
  }

  const res = await fetch(`${BASE}/upload/multi`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try {
      const body = await res.json();
      msg = body.detail ?? body.message ?? msg;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, msg);
  }

  const raw = await res.json();
  // Multi-upload returns combined_text / combined_diagrams — normalize.
  // We don't expose page_layouts through the multi endpoint yet
  // (each file has its own per-page positions which need to be
  // reassembled server-side); position-based assignment simply falls
  // back to per-page assignment by diagram id within the combined
  // diagrams dict.
  return {
    text: raw.combined_text ?? "",
    diagrams: normalizeDiagrams(raw.combined_diagrams),
  };
}
/**
 * Generate a quiz from extracted text + diagrams.
 *
 * @param text         Plain-text content extracted from the PDF.
 * @param diagrams     Diagrams extracted from the PDF (frontend camelCase shape).
 * @param timeoutMs    Client-side abort timeout (default 2 min, raise for large PDFs).
 * @param difficulty   "easy" | "medium" | "hard" | "mixed" (default backend: "mixed").
 * @param numQuestions How many questions to generate (default 10).
 */
// Backend wraps every /quiz/generate response as {quiz: Quiz|null, error: ErrorDetail|null}.
// The frontend needs to surface the error message when present (instead of treating an
// empty-quiz envelope as "the backend produced no questions") and unwrap to the inner Quiz
// for the rest of the app.
type QuizGenerateEnvelope = {
  quiz: Quiz | null;
  error: { error_type?: string; message?: string } | null;
};

export function generateQuiz(
  text: string,
  diagrams: Diagram[],
  timeoutMs: number = 120_000,
  difficulty?: string,
  numQuestions: number = 10,
): Promise<Quiz> {
  return callGenerateEndpoint("/quiz/generate", text, diagrams, timeoutMs, difficulty, numQuestions);
}

/**
 * Extract MCQs verbatim from the uploaded PDF (the "Exact" generation
 * mode). The backend uses a cheaper prompt and tags every returned
 * question with ``source_mode="extracted"`` + a ``page_number`` so the
 * UI can render provenance. Same response envelope shape as
 * ``generateQuiz`` — the caller treats the result identically.
 */
export function extractQuiz(
  text: string,
  diagrams: Diagram[],
  timeoutMs: number = 120_000,
  numQuestions: number = 10,
  pages: string[] = [],
  pageLayouts: unknown[] = [],
): Promise<Quiz> {
  return callGenerateEndpoint(
    "/quiz/extract",
    text,
    diagrams,
    timeoutMs,
    undefined,
    numQuestions,
    pages,
    pageLayouts,
  );
}

function callGenerateEndpoint(
  endpoint: "/quiz/generate" | "/quiz/extract",
  text: string,
  diagrams: Diagram[],
  timeoutMs: number,
  difficulty: string | undefined,
  numQuestions: number,
  pages: string[] = [],
  pageLayouts: unknown[] = [],
): Promise<Quiz> {
  // The backend expects diagrams as a dict keyed by diagram id (with
  // snake_case ``image_data`` field). Convert from the frontend array shape.
  const diagramsDict: Record<string, any> = {};
  for (const d of diagrams) {
    diagramsDict[d.id] = {
      id: d.id,
      page: d.page,
      image_data: d.imageData,
      source_file: d.sourceFile ?? null,
    };
  }

  const body: Record<string, unknown> = {
    text,
    diagrams: diagramsDict,
    num_questions: numQuestions,
  };
  if (difficulty !== undefined) body.difficulty = difficulty;
  if (pages.length > 0) body.pages = pages;
  // page_layouts is the position data the backend needs to assign
  // each figure to the correct question by Y-coordinate (overriding
  // the LLM's often-wrong over-broad diagramRefs). Only send for the
  // exact-mode endpoint — generation mode doesn't read this.
  if (endpoint === "/quiz/extract" && pageLayouts.length > 0) {
    body.page_layouts = pageLayouts;
  }

  return request<QuizGenerateEnvelope>(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // API keys live on the server (backend/.env) — never sent by the client.
      body: JSON.stringify(body),
    },
    timeoutMs,
  ).then((envelope) => {
    // 1) Top-level error envelope — server returned a structured failure
    //    (e.g. all keys exhausted, validation failure). Surface its message
    //    instead of letting the caller see a misleading "empty quiz" error.
    const topErr = envelope?.error;
    if (topErr && topErr.message) {
      throw new ApiError(200, topErr.message);
    }

    // 2) Quiz object missing entirely.
    const quiz = envelope?.quiz;
    if (!quiz) {
      throw new ApiError(200, "Quiz generation failed: no quiz in response.");
    }

    // 3) Defensive: some failure modes pack the error inside the quiz object.
    //    (Seen historically when a backend bug returned a partially-shaped
    //    response. Cheap to check here so the user always gets a real reason.)
    const nestedErr = (quiz as unknown as { error?: { message?: string } }).error;
    if (nestedErr?.message) {
      throw new ApiError(200, nestedErr.message);
    }

    // 4) Normalize the wire shape (snake_case → camelCase) before handing
    //    the Quiz to the rest of the app. Without this, fields like
    //    ``question.diagramIds`` are undefined on the client and crash
    //    React render with "Cannot read properties of undefined (reading
    //    'length')". An uncaught render error used to take the whole app
    //    down — now it would be caught by ErrorBoundary, but it's still a
    //    bad UX. Normalise at the boundary instead.
    return normalizeQuiz(quiz);
  });
}

export interface SolveOptions {
  /** Letter the quiz originally marked correct. For numerical questions,
   *  pass the expected number as a string instead. The backend uses this
   *  to cross-check the solver's answer and the response will include
   *  parsed_answer / answers_match so the UI can flag a hallucinated
   *  original answer. */
  correctAnswerId?: string;
  /** Question type — controls the solver's answer-line format.
   *  Defaults to "single" for backwards compat. */
  questionType?: "single" | "multiple" | "numerical";
  /** Numerical: expected number. Used as the cross-check "original"
   *  when correctAnswerId is not provided. */
  numericalAnswer?: number | null;
  /** Numerical: tolerance. Informational; solver doesn't use it. */
  numericalTolerance?: number;
}

// ── Admin (LLM key rotation) ────────────────────────────────────────────────

export interface AdminKeyView {
  provider: "gemini" | "minimax";
  masked_key: string;
  raw_value: string;
  source: string;
  key_count: number;
}

export interface AdminOverview {
  active_provider: string;
  gemini: AdminKeyView;
  minimax: AdminKeyView;
}

export interface UpdateKeyResponse {
  ok: boolean;
  provider: string;
  masked_key: string;
}

export interface TestKeyResponse {
  ok: boolean;
  provider: string;
  message: string;
}

export function getAdminOverview(): Promise<AdminOverview> {
  return request<AdminOverview>("/admin/overview", {}, 15_000);
}

export function updateAdminKey(
  provider: "gemini" | "minimax",
  value: string,
): Promise<UpdateKeyResponse> {
  return request<UpdateKeyResponse>("/admin/keys", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, value }),
  }, 30_000);
}

export function switchAdminProvider(
  provider: "gemini" | "minimax",
): Promise<UpdateKeyResponse> {
  return request<UpdateKeyResponse>("/admin/provider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  }, 15_000);
}

export function testAdminKey(
  provider: "gemini" | "minimax",
  value: string,
): Promise<TestKeyResponse> {
  return request<TestKeyResponse>("/admin/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, value }),
  }, 30_000);
}

export function solveQuestion(
  question: string,
  options: SolveRequest["options"],
  diagrams: Diagram[] = [],
  timeoutMs: number = 60_000,
  solveOpts: SolveOptions | string | undefined = {},
): Promise<{
  solution: string;
  parsedAnswer: string | null;
  originalAnswer: string | null;
  answersMatch: boolean | null;
}> {
  // Backwards-compat: if the 5th arg is a plain string, treat it as the
  // legacy `correctAnswerId` parameter.
  const opts: SolveOptions =
    typeof solveOpts === "string" || solveOpts === undefined
      ? { correctAnswerId: solveOpts as string | undefined }
      : solveOpts;

  // Decide which "original" the backend should cross-check against.
  // For numerical: prefer the explicit numericalAnswer (the actual
  // numeric value) over a stringified version, since the backend
  // performs a numeric-tolerant comparison.
  let originalForBackend: string | number | null = opts.correctAnswerId ?? null;
  if (
    opts.questionType === "numerical" &&
    opts.numericalAnswer != null &&
    Number.isFinite(opts.numericalAnswer)
  ) {
    originalForBackend = opts.numericalAnswer;
  }

  const diagramsPayload = diagrams.map((d) => ({
    id: d.id,
    page: d.page,
    image_data: d.imageData,
    source_file: d.sourceFile ?? null,
  }));
  return request<{
    solution?: string | null;
    error?: { message: string };
    parsed_answer?: string | null;
    original_answer?: string | null;
    answers_match?: boolean | null;
  }>(
    "/quiz/solve",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        options,
        diagrams: diagramsPayload,
        correct_answer_id: typeof originalForBackend === "string" ? originalForBackend : null,
        question_type: opts.questionType ?? "single",
        numerical_answer:
          typeof originalForBackend === "number" ? originalForBackend : null,
        numerical_tolerance: opts.numericalTolerance ?? 0,
      }),
    },
    timeoutMs,
  ).then((r) => {
    if (r.error || !r.solution) {
      throw new ApiError(200, r.error?.message || "Solve failed.");
    }
    return {
      solution: r.solution,
      parsedAnswer: r.parsed_answer ?? null,
      originalAnswer: r.original_answer ?? null,
      answersMatch: r.answers_match ?? null,
    };
  });
}

export function chatQuestion(
  question: string,
  options: ChatRequest["options"],
  diagrams: Diagram[],
  messages: ChatRequest["messages"],
  message: string,
  timeoutMs: number = 60_000,
): Promise<{ reply: string }> {
  const diagramsPayload = diagrams.map((d) => ({
    id: d.id,
    page: d.page,
    image_data: d.imageData,
    source_file: d.sourceFile ?? null,
  }));
  return request<{ reply?: string | null; error?: { message: string } }>(
    "/quiz/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        options,
        diagrams: diagramsPayload,
        prior_messages: messages,
        message,
      }),
    },
    timeoutMs,
  ).then((r) => {
    if (r.error || !r.reply) {
      throw new ApiError(200, r.error?.message || "Chat failed.");
    }
    return { reply: r.reply };
  });
}
