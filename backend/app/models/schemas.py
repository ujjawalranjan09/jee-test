"""Pydantic schemas shared across the API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ── Diagram ────────────────────────────────────────────────────────────────────

class Diagram(BaseModel):
    id: str
    page: int
    image_data: str  # base64-encoded image
    source_file: str | None = None


# ── Question ───────────────────────────────────────────────────────────────────

class QuestionOption(BaseModel):
    id: str  # "A", "B", "C", "D"
    text: str


# Question type — three supported shapes.
#   "single"    : one correct option (radio button).  uses `correct_answer_id`
#   "multiple"  : >1 correct option, all-or-nothing grading. uses `correct_answer_ids`
#   "numerical" : integer / decimal answer, typed by the student. uses `numerical_answer`
QuestionType = Literal["single", "multiple", "numerical"]


class Question(BaseModel):
    id: str
    prompt: str
    options: list[QuestionOption]
    # Type defaults to "single" so questions without a type field (older
    # extract output, hand-curated quizzes, etc.) keep working unchanged.
    type: QuestionType = "single"
    # Exactly one of these is meaningful per `type`:
    #   single    → correct_answer_id   (e.g. "B")
    #   multiple  → correct_answer_ids  (e.g. ["B", "C"])
    #   numerical → numerical_answer    (and optionally numerical_tolerance)
    correct_answer_id: str = ""
    correct_answer_ids: list[str] = Field(default_factory=list)
    numerical_answer: float | None = None
    # Allowed absolute error. 0 (default) = exact match. Integer-answer papers
    # can leave this at 0; physics "approximate" questions may want 0.01 / 0.1.
    numerical_tolerance: float = 0.0
    diagram_ids: list[str] = Field(default_factory=list)
    topic: str | None = None
    # Provenance metadata so the student knows where each question came from.
    # "extracted" = verbatim from the source PDF (with page number); "generated"
    # = synthesized by the LLM from the source material. Lets the UI show a
    # small chip on each question and lets review history distinguish the two.
    source_mode: str | None = None  # "extracted" | "generated"
    page_number: int | None = None  # only meaningful when source_mode == "extracted"


# ── Quiz ───────────────────────────────────────────────────────────────────────

class Quiz(BaseModel):
    id: str
    questions: list[Question]
    diagrams: dict[str, Diagram]


# ── Answer tracking ────────────────────────────────────────────────────────────

class AnswerState(BaseModel):
    """What the student picked for a question.

    The actual payload depends on ``Question.type``:
      single    → ``selected_option_id`` is set (e.g. "B")
      multiple  → ``selected_option_ids`` is a list (e.g. ["B", "C"])
      numerical → ``numerical_answer`` is a float (e.g. 25.0)

    Fields not relevant to the question type stay at their defaults.
    The frontend widens this model; the backend never inspects it.
    """
    question_id: str
    # Backwards-compatible single-correct field. Now defaults to empty string
    # and is only meaningful when the corresponding Question.type == "single".
    selected_option_id: str | None = None
    # New: list of selected option ids, used when Question.type == "multiple".
    selected_option_ids: list[str] = Field(default_factory=list)
    # New: typed-in number, used when Question.type == "numerical".
    numerical_answer: float | None = None
    marked_for_review: bool = False


# ── Upload request / response ──────────────────────────────────────────────────

class UploadResponse(BaseModel):
    text: str
    diagrams: dict[str, Diagram]
    # Structured per-page text (option-value-pool separated) for the
    # "Exact from PDF" mode. Empty list if extraction failed or PDF had no
    # structured layout — the LLM falls back to the raw ``text`` field.
    pages: list[str] = []
    # Per-page bbox positions (questions + figures). Used downstream by
    # the extract endpoint to assign figures to the nearest question
    # in Y-coord order. Always a list (one entry per page); empty list
    # means no position data.
    page_layouts: list[dict] = Field(default_factory=list)


class ErrorDetail(BaseModel):
    error_type: str
    message: str


# ── Quiz generation ────────────────────────────────────────────────────────────

class QuizGenerateRequest(BaseModel):
    text: str
    diagrams: dict[str, Diagram]
    # Structured per-page text — preferred over ``text`` for the extract
    # flow because it puts option-value fragments in their own bucket so
    # the LLM can match them back to questions. Empty list = fall back
    # to raw ``text``.
    pages: list[str] = []
    # Per-page layout for figure assignment. Each entry describes one page:
    #   ``question_ys``   = list of {y0, y1} bboxes for Q1, Q2, ...
    #   ``figure_ys``     = list of {y0, y1} bboxes for figures on the page
    # Used by the extract endpoint to assign each figure to the question
    # whose text is vertically nearest to it, overriding the LLM's
    # often-wrong assignment. Optional — empty list means "no position
    # data, trust the LLM" (legacy behaviour).
    page_layouts: list[dict] = Field(default_factory=list)
    num_questions: int = 10
    difficulty: str = "mixed"  # "easy" | "medium" | "hard" | "mixed"
    focus_topics: list[str] | None = None
    # Free-form so legacy strings (e.g. "conceptual", "theoretical") keep
    # working — the prompt builder filters against the three known types.
    question_types: list[str] | None = None


class QuizGenerateResponse(BaseModel):
    quiz: Quiz | None = None
    error: ErrorDetail | None = None


# ── Quiz solve ─────────────────────────────────────────────────────────────────

class SolveRequest(BaseModel):
    question: str
    options: list[QuestionOption]
    diagrams: list[Diagram] = Field(default_factory=list)
    # The answer the quiz generator originally marked as correct.
    #   - For single-correct MCQs, this is the option letter (e.g. "C").
    #   - For multi-correct MCQs, a comma-joined list (e.g. "B,C").
    #   - For numerical questions, the number as a string (e.g. "25" or "3.14").
    # Optional — when present, the response will include ``answers_match``
    # so the frontend can flag a mismatch if the solver reaches a
    # different answer. This catches LLM hallucinations during quiz
    # generation: the model can solve a problem correctly when prompted
    # directly but pick the wrong ``correct_answer_id`` when pressured
    # to also invent four options in the same JSON batch.
    correct_answer_id: str | None = None
    # Question type controls how the solver formats its trailing answer
    # line. Defaults to "single" for backwards compatibility.
    question_type: QuestionType = "single"
    # Optional expected numeric value (for numerical questions) — used by the
    # solver to format the answer line as a plain number, not a letter.
    numerical_answer: float | None = None
    # Tolerance for grading numerical answers. Solver doesn't use this
    # directly; it's returned in the response so the frontend can show it.
    numerical_tolerance: float = 0.0


class SolveResponse(BaseModel):
    solution: str | None = None
    # The answer the solver arrived at. Format depends on `question_type`:
    #   single    → letter (e.g. "D")
    #   multiple  → comma-joined letters (e.g. "B,C")
    #   numerical → number string (e.g. "25" or "3.14")
    # None if the solver did not produce a recognizable answer line.
    parsed_answer: str | None = None
    # Echo of the quiz's original claimed correct answer, when known.
    original_answer: str | None = None
    # ``True`` iff both answers are present and they agree. ``False``
    # indicates a likely hallucination at quiz-generation time and
    # lets the UI show a "this answer was wrong" warning instead of
    # silently misleading the student.
    answers_match: bool | None = None
    error: ErrorDetail | None = None


# ── Multi-PDF upload ─────────────────────────────────────────────────────────

class MultiUploadResponse(BaseModel):
    files: list[UploadResponse]
    combined_text: str
    combined_diagrams: dict[str, Diagram]


# ── Quiz export ──────────────────────────────────────────────────────────────

class QuizExportRequest(BaseModel):
    quiz: Quiz
    format: str  # "json" or "csv"


class QuizExportResponse(BaseModel):
    data: str | None = None  # JSON string or CSV content
    format: str | None = None
    error: ErrorDetail | None = None


# ── Quiz chat ──────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    question: str
    options: list[QuestionOption] = Field(default_factory=list)
    diagrams: list[Diagram] = Field(default_factory=list)
    prior_messages: list[ChatMessage] = Field(default_factory=list)
    message: str


class ChatResponse(BaseModel):
    reply: str | None = None
    error: ErrorDetail | None = None
