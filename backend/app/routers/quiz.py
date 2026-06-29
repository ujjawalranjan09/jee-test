"""Quiz-related endpoints: generate, solve, chat.

All LLM calls use the Gemini API keys declared in the backend environment
(``backend/.env`` via ``GEMINI_API_KEYS`` / ``GEMINI_API_KEY_1..9``). The
client never sends API keys — key management is a server-side concern.
"""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.config import settings
from app.models.schemas import (
    ChatRequest,
    ChatResponse,
    ErrorDetail,
    QuizExportRequest,
    QuizExportResponse,
    QuizGenerateRequest,
    QuizGenerateResponse,
    SolveRequest,
    SolveResponse,
)
from app.services.llm_client import LLMClient, LLMError
from app.services.quiz_generator import (
    QuizGenError,
    answers_match,
    chat_about_question,
    generate_quiz,
    solve_question,
)

router = APIRouter(tags=["quiz"])

_llm = LLMClient()


def _require_env_keys() -> list[str] | None:
    """Return the env-configured Gemini keys, or ``None`` if none configured.

    Surfacing this as HTTP 400 + structured error (instead of letting every
    request burn 60s on retries) lets the client render a clear message.
    """
    keys = settings.env_api_keys()
    if not keys:
        return None
    return keys


def _err_payload(error_type: str, message: str) -> dict:
    """Serialised error body matching the response_model shape."""
    return QuizGenerateResponse(
        error=ErrorDetail(error_type=error_type, message=message)
    ).model_dump()


# ── POST /quiz/generate ───────────────────────────────────────────────────────

@router.post("/quiz/generate", response_model=QuizGenerateResponse)
async def quiz_generate(req: QuizGenerateRequest):
    keys = _require_env_keys()
    if keys is None:
        return JSONResponse(
            status_code=400,
            content=_err_payload(
                "no_keys",
                "No Gemini API keys are configured on the server. "
                "Set GEMINI_API_KEYS or GEMINI_API_KEY_1 in backend/.env.",
            ),
        )

    # TEMP DEBUG: capture what the frontend actually sends.
    import logging as _lg
    _lg.getLogger("quiz_in").info(
        "GENERATE req: text=%d chars, diagrams=%d, num_q=%d, difficulty=%s",
        len(req.text or ""), len(req.diagrams or {}), req.num_questions, req.difficulty,
    )

    try:
        quiz = await generate_quiz(
            text=req.text,
            diagrams={did: d.model_dump() for did, d in req.diagrams.items()},
            num_questions=req.num_questions,
            api_keys=keys,
            llm_client=_llm,
            difficulty=req.difficulty,
            focus_topics=req.focus_topics,
            question_types=req.question_types,
        )
        _lg.getLogger("quiz_out").info(
            "GENERATE result: %d questions returned (out of %d requested)",
            len(quiz.questions), req.num_questions,
        )
        return QuizGenerateResponse(quiz=quiz)
    except QuizGenError as exc:
        # 200 + structured error: client can render the actual message.
        # (Previously 502 — the frontend swallowed it as "Request failed (502)"
        # without parsing the error body.)
        return JSONResponse(
            status_code=200,
            content=_err_payload(exc.error_type, exc.message),
        )
    except LLMError as exc:
        return JSONResponse(
            status_code=200,
            content=_err_payload(exc.error_type, str(exc)),
        )


# ── POST /quiz/extract ────────────────────────────────────────────────────────

@router.post("/quiz/extract", response_model=QuizGenerateResponse)
async def quiz_extract(req: QuizGenerateRequest):
    """Extract verbatim multiple-choice questions from the source PDF.

    Cheaper than ``/quiz/generate`` (no question synthesis) and useful
    when the student wants to practice the actual exam paper rather
    than new questions on the same topic. Same response shape as
    ``/quiz/generate`` so the frontend doesn't need to differentiate
    downstream — each question just gets a ``source_mode`` tag and a
    ``page_number`` so the UI can show provenance.
    """
    keys = _require_env_keys()
    if keys is None:
        return JSONResponse(
            status_code=400,
            content=_err_payload(
                "no_keys",
                "No Gemini API keys configured on the server.",
            ),
        )
    try:
        # Lazy import to avoid a top-level cycle through the service
        # module's heavy imports.
        from app.services.quiz_generator import extract_questions_from_pdf

        quiz = await extract_questions_from_pdf(
            text=req.text,
            diagrams={k: v.model_dump() for k, v in req.diagrams.items()},
            num_questions=req.num_questions,
            api_keys=keys,
            llm_client=_llm,
            pages=req.pages or None,
            page_layouts=req.page_layouts or None,
        )
        return QuizGenerateResponse(quiz=quiz)
    except QuizGenError as exc:
        return JSONResponse(
            status_code=200,
            content=_err_payload(exc.error_type, exc.message),
        )
    except LLMError as exc:
        return JSONResponse(
            status_code=200,
            content=_err_payload(exc.error_type, str(exc)),
        )


# ── POST /quiz/solve ──────────────────────────────────────────────────────────

@router.post("/quiz/solve", response_model=SolveResponse)
async def quiz_solve(req: SolveRequest):
    keys = _require_env_keys()
    if keys is None:
        return JSONResponse(
            status_code=400,
            content=SolveResponse(
                error=ErrorDetail(error_type="no_keys", message="No Gemini API keys configured on the server.")
            ).model_dump(),
        )
    try:
        result = await solve_question(
            question=req.question,
            options=req.options,
            diagrams=[d.model_dump() for d in req.diagrams],
            api_keys=keys,
            llm_client=_llm,
            question_type=req.question_type,
        )
        # For numerical questions, the "original" answer is the number, not
        # a letter. For multi-correct, it's a comma-joined list. The cross-
        # check tolerates all three shapes via ``answers_match`` / ``_normalize_answer``.
        original = req.correct_answer_id
        if original is None and req.question_type == "numerical" and req.numerical_answer is not None:
            original = str(req.numerical_answer)
        return SolveResponse(
            solution=result.text,
            parsed_answer=result.parsed_answer,
            original_answer=original,
            answers_match=answers_match(
                result.parsed_answer, original
            ),
        )
    except LLMError as exc:
        return JSONResponse(
            status_code=200,
            content=SolveResponse(
                error=ErrorDetail(error_type=exc.error_type, message=str(exc))
            ).model_dump(),
        )


# ── POST /quiz/chat ───────────────────────────────────────────────────────────

@router.post("/quiz/chat", response_model=ChatResponse)
async def quiz_chat(req: ChatRequest):
    # Validate message
    if not req.message or not req.message.strip():
        return JSONResponse(
            status_code=400,
            content=ChatResponse(
                error=ErrorDetail(error_type="empty_message", message="Message must not be empty.")
            ).model_dump(),
        )
    if len(req.message) > settings.CHAT_MESSAGE_MAX_CHARS:
        return JSONResponse(
            status_code=400,
            content=ChatResponse(
                error=ErrorDetail(
                    error_type="message_too_long",
                    message=f"Message exceeds {settings.CHAT_MESSAGE_MAX_CHARS} characters.",
                )
            ).model_dump(),
        )

    keys = _require_env_keys()
    if keys is None:
        return JSONResponse(
            status_code=400,
            content=ChatResponse(
                error=ErrorDetail(error_type="no_keys", message="No Gemini API keys configured on the server.")
            ).model_dump(),
        )

    try:
        reply = await chat_about_question(
            question=req.question,
            options=req.options,
            diagrams=[d.model_dump() for d in req.diagrams],
            prior_messages=req.prior_messages,
            new_message=req.message,
            api_keys=keys,
            llm_client=_llm,
        )
        return ChatResponse(reply=reply)
    except LLMError as exc:
        return JSONResponse(
            status_code=200,
            content=ChatResponse(
                error=ErrorDetail(error_type=exc.error_type, message=str(exc))
            ).model_dump(),
        )


# ── POST /quiz/export ─────────────────────────────────────────────────────────

@router.post("/quiz/export", response_model=QuizExportResponse)
async def quiz_export(req: QuizExportRequest):
    """Export a quiz in JSON or CSV format."""
    fmt = req.format.lower()
    if fmt not in ("json", "csv"):
        return JSONResponse(
            status_code=400,
            content=QuizExportResponse(
                error=ErrorDetail(
                    error_type="invalid_format",
                    message=f'Unsupported format "{req.format}". Use "json" or "csv".',
                )
            ).model_dump(),
        )

    if fmt == "json":
        data = req.quiz.model_dump_json(indent=2)
        return QuizExportResponse(data=data, format="json")

    # CSV export
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "question", "option_a", "option_b", "option_c", "option_d",
        "correct_answer", "topic", "difficulty",
    ])
    for q in req.quiz.questions:
        opt_map = {o.id: o.text for o in q.options}
        writer.writerow([
            q.prompt,
            opt_map.get("A", ""),
            opt_map.get("B", ""),
            opt_map.get("C", ""),
            opt_map.get("D", ""),
            q.correct_answer_id,
            q.topic or "",
            getattr(q, "difficulty", "") or "",
        ])
    return QuizExportResponse(data=output.getvalue(), format="csv")