"""Quiz generation, solve, and chat logic using the LLM client."""

from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass

from app.config import settings
from app.models.schemas import (
    ChatMessage,
    Diagram,
    Question,
    QuestionOption,
    Quiz,
)
from app.services.llm_client import LLMClient, LLMError, build_image_parts

logger = logging.getLogger(__name__)


# ── Exceptions ─────────────────────────────────────────────────────────────────

class QuizGenError(Exception):
    error_type: str = "quiz_gen_error"

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class QuizTimeoutError(QuizGenError):
    error_type = "quiz_timeout"


class QuizValidationError(QuizGenError):
    error_type = "quiz_validation"


# ── Prompt construction ────────────────────────────────────────────────────────

_QUIZ_SYSTEM = """You are a quiz generator. Given educational text and optional diagrams, \
generate exactly {n} questions in a MIX of three types.

{difficulty_instruction}
{focus_instruction}
{types_instruction}

The three question types and their JSON shapes:

1. "single" — exactly one correct option (radio button).
   {{
     "type": "single",
     "prompt": "string",
     "options": [{{"id":"A","text":"..."}},{{"id":"B","text":"..."}},{{"id":"C","text":"..."}},{{"id":"D","text":"..."}}],
     "correctAnswerId": "B"
   }}

2. "multiple" — more than one option is correct (checkbox group, all-or-nothing grading).
   {{
     "type": "multiple",
     "prompt": "Which of the following are prime numbers? (Select all that apply)",
     "options": [{{"id":"A","text":"2"}},{{"id":"B","text":"4"}},{{"id":"C","text":"5"}},{{"id":"D","text":"7"}}],
     "correctAnswerIds": ["A","C","D"]
   }}

3. "numerical" — student types the answer (a number). No options.
   {{
     "type": "numerical",
     "prompt": "A body starting from rest accelerates at 2 m/s². Find the distance in 5 seconds (meters).",
     "options": [],
     "numericalAnswer": 25,
     "numericalTolerance": 0.01
   }}

Type classification rules:
- If the source mentions "select all that apply", "which of the following are",
  or the answer key has >1 letter per question → "multiple".
- If the source is a numerical/calculation question with no options, the answer
  is a number (integer or decimal), or the answer key gives a single number → "numerical".
- Otherwise → "single" (the most common case in textbooks).

Numerical tolerance rules:
- Default to 0 (exact match) — fine for integer answers and exact problems.
- Use 0.01 (or 0.1) for approximate physics/engineering values where
  the LLM is computing (e.g. 9.81 vs 9.80665).
- Never use a tolerance wider than 1 unless the question explicitly says so.

Return ONLY valid JSON matching this top-level schema (no markdown, no explanation):
{{
  "questions": [
    {{<one of the three shapes above, plus "topic" and "diagramRefs">}}
  ]
}}

Additional rules:
- "topic": a short descriptive string (e.g. "Algebra", "Thermodynamics").
- "diagramRefs": list of diagram ids relevant to the question (use [] if none).
- Each "single" / "multiple" question MUST have exactly 4 options (A, B, C, D).
- "numerical" questions MUST have an empty `options: []` array — do NOT invent choices.
- Do NOT include any text outside the JSON object.
- If you can't determine the type for a question, default to "single"
  rather than skipping the question.
"""

_SOLVE_SYSTEM = """You are a helpful tutor. Given a question, its options (if any), \
and optional diagrams, provide a clear step-by-step solution explaining the reasoning. \
End with the answer on its own line in the format specified for this question type."""

# Format-string hint for each question type, appended to the system prompt so
# the solver always knows how to format the trailing answer line.
_SOLVE_ANSWER_FORMAT = {
    "single":    'End with "Answer: X" where X is the correct option letter (A, B, C, or D).',
    "multiple":  'End with "Answer: X, Y" (comma-separated, no spaces) where each letter is one of the correct options.',
    "numerical": 'End with "Answer: <number>" where <number> is the numeric value (e.g. 25 or 3.14).',
}


# ── Answer-line parser ─────────────────────────────────────────────────────────

# Matches lines like:
#   "Answer: D"
#   "Answer: A."
#   "**Answer: B**"
#   "Answer = C"
#   "Answer: 25"
#   "Answer: B, C"
# Tolerates trailing punctuation / whitespace / markdown bold markers.
# The first match wins; we anchor to the last line because the model
# is instructed to put the answer at the end of the solution.
_ANSWER_LINE_RE = re.compile(
    r"""
    (?:^|\n)\s*         # start of line or string
    [\W_]*               # optional leading decoration (**, #, etc.)
    answer\s*[:=]\s*    # the word "answer" + ":" or "="
    (?P<value>[^\n*_]+?) # capture the value (letter, number, list, …)
    \s*[\W_]*            # optional trailing decoration (**) and whitespace
    \s*\.?\s*$           # optional trailing period
    """,
    re.VERBOSE | re.IGNORECASE,
)


def parse_solver_answer(solution_text: str) -> str | None:
    """Extract the trailing ``Answer: X`` value from a solution string.

    Returns the trimmed value (a letter, comma-joined letters, or a number
    string) uppercased, or ``None`` if no recognizable answer line is
    found. This is a best-effort parser: it tolerates common decorations
    the LLM adds (bold, punctuation) but does not try to recover from
    genuinely missing answers.
    """
    if not solution_text:
        return None
    matches = list(_ANSWER_LINE_RE.finditer(solution_text))
    if not matches:
        return None
    # Use the last match — the model is told to put the answer at the end.
    raw = matches[-1].group("value").strip()
    return raw.upper() if raw else None


def answers_match(parsed: str | None, original: str | None) -> bool | None:
    """Compare two answer strings (tolerant of trailing punctuation /
    whitespace / case differences).

    Returns ``None`` when either side is missing (we don't have enough
    info to judge), ``True`` when both agree, ``False`` otherwise.
    """
    if not parsed or not original:
        return None
    return _normalize_answer(parsed) == _normalize_answer(original)


def _normalize_answer(s: str) -> str:
    """Normalize an answer for comparison.

    - Strips whitespace
    - Lowercases
    - For comma-joined lists, sorts the items (so "B, C" == "C,B")
    - For numbers, uses float() to collapse "25" / "25.0" / "  25  "
    - For letters, leaves them as-is
    """
    parts = [p.strip() for p in s.replace(";", ",").split(",") if p.strip()]
    if len(parts) <= 1:
        token = s.strip()
        try:
            return f"{float(token):g}"  # "25.0" → "25", "3.14" → "3.14"
        except (ValueError, TypeError):
            return token.lower()
    # Comma-list path: try to coerce each part to a float, otherwise lowercase.
    coerced: list[str] = []
    for p in parts:
        try:
            coerced.append(f"{float(p):g}")
        except (ValueError, TypeError):
            coerced.append(p.lower())
    return ",".join(sorted(coerced))

_CHAT_SYSTEM = """You are a helpful tutor assistant. You are helping a student understand \
a multiple-choice question. Use the conversation history and any provided diagrams to give \
clear, concise answers. If you are unsure, say so."""


# ── Parse & validate LLM JSON ─────────────────────────────────────────────────

_DIFFICULTY_INSTRUCTIONS = {
    "easy": "All questions should be easy difficulty: basic recall and straightforward application.",
    "medium": "All questions should be medium difficulty: requires understanding and multi-step reasoning.",
    "hard": "All questions should be hard difficulty: complex problems requiring deep analysis.",
    "mixed": "Vary difficulty across questions: include a mix of easy, medium, and hard questions.",
}


def _build_quiz_prompt(
    *,
    n: int,
    difficulty: str = "mixed",
    focus_topics: list[str] | None = None,
    question_types: list[str] | None = None,
) -> str:
    """Build the system prompt with difficulty, focus topics, and question type filters."""
    difficulty_instruction = _DIFFICULTY_INSTRUCTIONS.get(
        difficulty, _DIFFICULTY_INSTRUCTIONS["mixed"]
    )

    focus_instruction = ""
    if focus_topics:
        topic_list = ", ".join(f'"{t}"' for t in focus_topics)
        focus_instruction = f"Generate questions ONLY about these topics: {topic_list}."

    types_instruction = ""
    if question_types:
        type_list = ", ".join(f'"{t}"' for t in question_types)
        types_instruction = f"Include these types of questions: {type_list}."

    return _QUIZ_SYSTEM.format(
        n=n,
        difficulty_instruction=difficulty_instruction,
        focus_instruction=focus_instruction,
        types_instruction=types_instruction,
    )


def _parse_quiz_json(raw: str, valid_diagram_ids: set[str]) -> list[Question]:
    """Parse raw LLM JSON into Question objects, dropping invalid diagramRefs.

    Tolerant of:
    * Markdown code fences (``` or ~~~)
    * Truncated output (the LLM hit ``max_tokens`` mid-generation).
      We try to recover any complete ``{"id": ..., "prompt": ..., "options": ...}``
      objects from the partial text rather than dropping the whole batch.
    """
    cleaned = raw.strip()
    if cleaned.startswith(("```", "~~~")):
        fence = cleaned[:3]
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith(fence)]
        cleaned = "\n".join(lines)

    try:
        data = json.loads(cleaned)
        return _extract_questions_from_dict(data, valid_diagram_ids)
    except json.JSONDecodeError as first_err:
        # Response was truncated mid-string. Try to recover complete question
        # objects by finding balanced top-level ``{...}`` blocks inside the
        # ``"questions": [...]`` array.
        recovered = _recover_partial_questions(cleaned, valid_diagram_ids)
        if recovered:
            logger.warning(
                "LLM response was truncated (%s); recovered %d partial questions.",
                first_err.msg, len(recovered),
            )
            return recovered
        # Nothing recoverable — re-raise so the caller sees a clear error.
        raise QuizValidationError(f"LLM response not valid JSON: {first_err.msg}") from first_err


def _extract_questions_from_dict(data: dict, valid_diagram_ids: set[str]) -> list[Question]:
    if "questions" not in data:
        raise QuizValidationError("LLM response missing 'questions' key.")

    questions: list[Question] = []
    for i, q in enumerate(data["questions"]):
        try:
            questions.append(_build_question_from_dict(q, valid_diagram_ids, idx=i))
        except _SkipQuestion as exc:
            logger.warning("Skipping malformed question %d: %s", i, exc)
    return questions


class _SkipQuestion(Exception):
    """Raised by ``_build_question_from_dict`` when a question is unrecoverable
    and the caller should drop it from the quiz."""


def _build_question_from_dict(
    q: dict,
    valid_diagram_ids: set[str],
    *,
    idx: int,
) -> Question:
    """Build a Question from one LLM-emitted dict. Branches on ``type``:

    - "single"    → uses correctAnswerId (defaults to "single" if missing)
    - "multiple"  → uses correctAnswerIds (all-or-nothing grading)
    - "numerical" → uses numericalAnswer (+ optional numericalTolerance),
                    options forced to []
    """
    if not isinstance(q, dict):
        raise _SkipQuestion(f"expected dict, got {type(q).__name__}")

    raw_type = q.get("type")
    qtype = _coerce_question_type(raw_type)
    if qtype is None:
        # LLM emitted an unknown type — try the keyword-based classifier.
        qtype = classify_question_type(q)
    qtype = qtype or "single"

    prompt_text = str(q.get("prompt", "")).strip()
    if not prompt_text:
        raise _SkipQuestion("missing or empty 'prompt'")

    raw_refs = q.get("diagramRefs", [])
    valid_refs = [r for r in raw_refs if isinstance(r, str) and r in valid_diagram_ids]
    topic = str(q.get("topic")) if q.get("topic") else None

    # Default id; may be overridden by caller (e.g. extract path uses
    # "q-extracted-N" so UI can group by source).
    qid = str(q.get("id") or f"q-{idx + 1}")

    if qtype == "numerical":
        # Force options to [] and require numericalAnswer to be a number.
        num = q.get("numericalAnswer")
        if num is None or not isinstance(num, (int, float)):
            raise _SkipQuestion(f"numerical question missing valid 'numericalAnswer' (got {num!r})")
        tol = q.get("numericalTolerance", 0.0)
        if not isinstance(tol, (int, float)):
            tol = 0.0
        return Question(
            id=qid,
            prompt=prompt_text,
            options=[],
            type="numerical",
            correct_answer_id="",
            correct_answer_ids=[],
            numerical_answer=float(num),
            numerical_tolerance=float(tol),
            diagram_ids=valid_refs,
            topic=topic,
        )

    # single OR multiple — both need options
    opts_raw = q.get("options", [])
    if not isinstance(opts_raw, list):
        raise _SkipQuestion("'options' must be a list")
    opts = []
    for j, o in enumerate(opts_raw):
        if not isinstance(o, dict):
            continue
        raw_id = o.get("id", "")
        # Normalise option ids to A/B/C/D. The LLM sometimes echoes the
        # source's "(1)(2)(3)(4)" labels instead of mapping to letters —
        # rule B2 in the extract prompt tells it to map, but we double-
        # check here so the UI never sees stray "1"/"2"/"3"/"4" ids.
        if isinstance(raw_id, str):
            rid = raw_id.strip().upper()
            # Strip surrounding parens → "(2)" → "2"
            if rid.startswith("(") and rid.endswith(")"):
                rid = rid[1:-1].strip()
            # Numeric labels (1/2/3/4) → A/B/C/D
            if rid in ("1", "2", "3", "4"):
                rid = chr(ord("A") + int(rid) - 1)
            # Anything else (already A/B/C/D, or junk) passes through;
            # the existing pad step below will fix gaps.
            opt_id = rid
        else:
            opt_id = chr(ord("A") + j)
        opts.append(
            QuestionOption(
                id=opt_id or chr(ord("A") + j),
                text=str(o.get("text", "")),
            )
        )
    # Pad to exactly 4 slots A-D for UI consistency. We never invent text,
    # we just create empty placeholders. The UI hides empty options in single
    # / multiple renders anyway.
    seen_ids = {o.id for o in opts if o.id}
    for j in range(len(opts), 4):
        letter = chr(ord("A") + j)
        if letter in seen_ids:
            continue
        opts.append(QuestionOption(id=letter, text=""))
        seen_ids.add(letter)
    if len(opts) > 4:
        opts = opts[:4]  # type: ignore[assignment] 

    if qtype == "multiple":
        raw_ids = q.get("correctAnswerIds", [])
        if not isinstance(raw_ids, list):
            raise _SkipQuestion("'correctAnswerIds' must be a list for type='multiple'")
        # Normalize: letters or "(1)" → A/B/C/D, de-dup, keep only known option ids
        valid_id_set = {o.id for o in opts}
        normalized = []
        for v in raw_ids:
            if not isinstance(v, str):
                continue
            letter = _normalize_letter_token(v)
            if letter and letter in valid_id_set and letter not in normalized:
                normalized.append(letter)
        return Question(
            id=qid,
            prompt=prompt_text,
            options=opts,
            type="multiple",
            correct_answer_id="",
            correct_answer_ids=normalized,
            numerical_answer=None,
            numerical_tolerance=0.0,
            diagram_ids=valid_refs,
            topic=topic,
        )

    # qtype == "single" (the default)
    correct = _normalize_letter_token(str(q.get("correctAnswerId", "")))
    valid_id_set = {o.id for o in opts}
    if correct and correct not in valid_id_set:
        # LLM gave us a letter that doesn't match any option — drop it
        # so the UI can flag "answer not provided" instead of falsely grading.
        correct = ""
    return Question(
        id=qid,
        prompt=prompt_text,
        options=opts,
        type="single",
        correct_answer_id=correct,
        correct_answer_ids=[],
        numerical_answer=None,
        numerical_tolerance=0.0,
        diagram_ids=valid_refs,
        topic=topic,
    )


def _coerce_question_type(raw: object) -> str | None:
    """Normalize the LLM's ``type`` field. Returns None if invalid/missing."""
    if not isinstance(raw, str):
        return None
    t = raw.strip().lower()
    if t in ("single", "multiple", "numerical"):
        return t
    # LLM might write "multi", "multi-select", "number", "numeric" — be lenient.
    if t in ("multi", "multi-select", "multi_select", "select_all", "selectall"):
        return "multiple"
    if t in ("number", "numeric", "int", "integer", "decimal", "float"):
        return "numerical"
    if t in ("mcq", "mc", "single_choice", "singlechoice"):
        return "single"
    return None


# Answer-key patterns used by the classifier fallback. We only use these
# when the LLM forgot to set `type`.
_MULTI_ANSWER_PATTERNS = [
    re.compile(r"\bAnswers?\s*[:=]\s*\(?([A-D]\s*[,/&]\s*[A-D])", re.IGNORECASE),
    re.compile(r"\bAnswers?\s*[:=]\s*([A-D])\s*,\s*([A-D])", re.IGNORECASE),
]
_NUMERICAL_PROMPT_HINTS = (
    "find the value",
    "find the answer",
    "compute",
    "calculate the",
    "value of x",
    "value of y",
    "answer is",
    "the value of",
    "numerical answer",
    "type the answer",
    "enter the answer",
)


def classify_question_type(q: dict) -> str | None:
    """Best-effort classifier for when the LLM forgets to set ``type``.

    Returns "single" | "multiple" | "numerical" | None.
    Heuristics (cheap, intentionally simple):
      1. Has non-empty ``correctAnswerIds`` (array) → "multiple"
      2. Has non-None ``numericalAnswer`` → "numerical"
      3. Prompt text matches numerical hints → "numerical"
      4. Prompt contains "select all" / "which of the following are" → "multiple"
      5. Otherwise → "single" (the safest default)
    """
    if not isinstance(q, dict):
        return None
    if isinstance(q.get("correctAnswerIds"), list) and q["correctAnswerIds"]:
        return "multiple"
    if q.get("numericalAnswer") is not None:
        return "numerical"
    prompt = (q.get("prompt") or "").lower()
    if prompt:
        if "select all" in prompt or "which of the following are" in prompt:
            return "multiple"
        for hint in _NUMERICAL_PROMPT_HINTS:
            if hint in prompt:
                return "numerical"
    return "single"


def _recover_partial_questions(cleaned: str, valid_diagram_ids: set[str]) -> list[Question]:
    """Best-effort recovery of complete question objects from truncated JSON.

    Strategy: walk the string, track string-quote and brace depth, and at each
    point where we have a balanced ``{...}`` that contains one of the answer
    markers (``correctAnswerId`` / ``correctAnswerIds`` / ``numericalAnswer``)
    plus a ``prompt`` and ``options``/type info, try to parse just that
    substring as JSON.
    """
    import re
    recovered: list[Question] = []
    # Naive but effective: find all top-level dict-looking substrings inside
    # the ``"questions"`` array. If the text doesn't contain the array keyword
    # at all we can't recover anything.
    if '"questions"' not in cleaned and "'questions'" not in cleaned:
        return []

    # Find each block that looks like one of the three question shapes.
    # We match on `prompt` + any one of the three answer markers, then
    # extend the match to the closing brace.
    pattern = re.compile(
        r'\{\s*"prompt"\s*:\s*"[^"]*(?:\\.[^"]*)*"\s*,\s*'
        r'"options"\s*:\s*\[[^\]]*\]\s*,\s*'
        r'"?correctAnswer(?:Id|Ids)?"?\s*:',
        re.DOTALL,
    )
    for m in pattern.finditer(cleaned):
        # Extend the match to include the closing brace of this object.
        start = m.start()
        depth = 0
        end = start
        in_str = False
        esc = False
        for i in range(start, len(cleaned)):
            ch = cleaned[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        candidate = cleaned[start:end]
        try:
            obj = json.loads(candidate)
            recovered.extend(_extract_questions_from_dict({"questions": [obj]}, valid_diagram_ids))
        except Exception:
            continue

    # Also try to recover numerical questions (no `options` field).
    num_pattern = re.compile(
        r'\{\s*"prompt"\s*:\s*"[^"]*(?:\\.[^"]*)*"\s*,\s*'
        r'"options"\s*:\s*\[\s*\]\s*,\s*'
        r'"numericalAnswer"\s*:\s*',
        re.DOTALL,
    )
    for m in num_pattern.finditer(cleaned):
        start = m.start()
        depth = 0
        end = start
        in_str = False
        esc = False
        for i in range(start, len(cleaned)):
            ch = cleaned[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        candidate = cleaned[start:end]
        try:
            obj = json.loads(candidate)
            recovered.extend(_extract_questions_from_dict({"questions": [obj]}, valid_diagram_ids))
        except Exception:
            continue

    return recovered


# ── Batched quiz generation ────────────────────────────────────────────────────

async def generate_quiz(
    *,
    text: str,
    diagrams: dict[str, dict],
    num_questions: int,
    api_keys: list[str],
    llm_client: LLMClient,
    difficulty: str = "mixed",
    focus_topics: list[str] | None = None,
    question_types: list[str] | None = None,
) -> Quiz:
    """Generate a quiz with batching (≤ QUIZ_BATCH_SIZE questions per LLM call).

    Free-tier rate-limit friendly:
    * Caps diagrams per batch (project quota, not key quota, is the limiter).
    * Truncates the input text per batch.
    * Sleeps between batches to stay under requests-per-minute.
    """
    import asyncio as _asyncio

    batch_size = settings.QUIZ_BATCH_SIZE
    batches: list[int] = []
    remaining = num_questions
    while remaining > 0:
        batches.append(min(remaining, batch_size))
        remaining -= batch_size

    all_questions: list[Question] = []
    valid_diagram_ids = set(diagrams.keys())

    # Pick a stable subset of diagrams to attach across all batches.
    # When there are more diagrams than the cap, send the first N (figures
    # early in a textbook are most often referenced). Sending the same set
    # to every batch keeps the LLM grounded in the same visuals.
    # 0 means "no cap" — send every diagram on every batch (paid-tier default).
    diagram_cap = max(0, settings.MAX_DIAGRAMS_PER_BATCH)
    diagram_items = list(diagrams.items())
    if diagram_cap == 0:
        selected_diagrams = dict(diagram_items)
    else:
        selected_diagrams = dict(diagram_items[:diagram_cap])

    # 0 means "no cap" — send the entire PDF text (paid-tier default).
    text_cap = max(0, settings.MAX_TEXT_CHARS_PER_BATCH)

    for batch_idx, batch_n in enumerate(batches):
        system_prompt = _build_quiz_prompt(
            n=batch_n,
            difficulty=difficulty,
            focus_topics=focus_topics,
            question_types=question_types,
        )

        # Truncate text per batch. Keep the head (intro + early content) which
        # is usually where the easiest, most-cited questions come from.
        # text_cap == 0 means "no truncation".
        if text_cap and len(text) > text_cap:
            batch_text = text[:text_cap]
            batch_text += (
                f"\n\n[Note: source text was truncated to {text_cap} characters "
                f"for this batch to stay within rate limits. Full document has "
                f"{len(text)} characters.]"
            )
        else:
            batch_text = text
        prompt_text = system_prompt + "\n\n---\n\n" + batch_text

        prompt_parts: list = [prompt_text]
        if selected_diagrams:
            prompt_parts.extend(build_image_parts(list(selected_diagrams.values())))

        # Pace requests — only sleep between batches, not before the first.
        if batch_idx > 0 and settings.LLM_INTER_BATCH_DELAY_SECONDS > 0:
            logger.info(
                "Pacing: sleeping %.1fs between batches (batch %d/%d)",
                settings.LLM_INTER_BATCH_DELAY_SECONDS, batch_idx + 1, len(batches),
            )
            await _asyncio.sleep(settings.LLM_INTER_BATCH_DELAY_SECONDS)

        try:
            resp = await llm_client.generate(api_keys=api_keys, prompt_parts=prompt_parts)
        except LLMError as exc:
            raise QuizTimeoutError(str(exc)) from exc

        try:
            questions = _parse_quiz_json(resp.text, valid_diagram_ids)
        except QuizGenError:
            raise
        except Exception as exc:
            # Anything else (e.g. unexpected LLM response shape) → fail this
            # batch but don't bring down the whole request.
            logger.warning("Failed to parse batch %d response: %s", batch_idx + 1, exc)
            questions = []

        all_questions.extend(questions)

    # Assign final sequential ids
    for i, q in enumerate(all_questions):
        q.id = f"q-{i + 1}"

    # Collect only diagrams actually referenced
    referenced_ids: set[str] = set()
    for q in all_questions:
        referenced_ids.update(q.diagram_ids)

    quiz = Quiz(
        id=str(uuid.uuid4()),
        questions=all_questions,
        diagrams={did: Diagram(**diagrams[did]) for did in referenced_ids if did in diagrams},
    )
    return quiz


def _normalize_letter_token(v: str) -> str:
    """Normalise a letter-token from the LLM to an A/B/C/D string.

    Accepts: ``"B"``, ``"b"``, ``"(2)"``, ``"2"``, ``"(b)"``, ``"option b"``.
    Returns the canonical A/B/C/D letter, or ``""`` if unparseable.
    """
    s = v.strip()
    if not s:
        return ""
    # Strip surrounding parens / "option " prefixes
    s = s.strip("()").strip()
    if s.lower().startswith("option"):
        s = s.split()[-1] if s.split() else ""
    s = s.strip().upper()
    if s in ("A", "B", "C", "D"):
        return s
    if s in ("1", "2", "3", "4"):
        return chr(ord("A") + int(s) - 1)
    return ""


# ── Question extraction (verbatim from PDF) ───────────────────────────────────

_EXTRACT_SYSTEM = """You are an exam-question extractor. Given the text of an educational \
document (with optional diagrams), identify every question that already appears in \
the source material and return it VERBATIM. Three question types are supported:

1. "single" — exactly one correct option.
   {{ "type":"single", "prompt":"...", "options":[{{"id":"A","text":"..."}},{{"id":"B","text":"..."}}], "correctAnswerId":"B", "pageNumber":1, "diagramRefs":["page-1-figure-1"], "topic":"..." }}

2. "multiple" — more than one correct option (all-or-nothing grading).
   {{ "type":"multiple", "prompt":"Which of the following are X? (Select all that apply)", "options":[{{"id":"A","text":"..."}},{{"id":"B","text":"..."}}], "correctAnswerIds":["A","C"], "pageNumber":2, "diagramRefs":[], "topic":"..." }}

3. "numerical" — student types a number. No options.
   {{ "type":"numerical", "prompt":"Find the value of x.", "options":[], "numericalAnswer":3.14, "numericalTolerance":0.01, "pageNumber":3, "diagramRefs":["page-1-figure-2"], "topic":"..." }}

═══════════════════════════════════════════════════════════════════════════════════
CRITICAL RULES — read these carefully. They override any defaults.
═══════════════════════════════════════════════════════════════════════════════════

A) BLANK + OPTIONS = STILL MCQ. A question prompt may contain "____" blanks AND \
still have (1)(2)(3)(4) option labels with values (common in JEE/NEET). \
HOWEVER, the presence of blanks ALONE does NOT make it numerical. \
To decide, use this checklist IN ORDER:
   i)  Does the ANSWER KEY give a letter like (2), (3), (4)? → "single" MCQ.
   ii) Do (1)(2)(3)(4) labels appear WITH actual option values (not just bare labels)?
       → "single" MCQ.
   iii) ONLY if NEITHER i) NOR ii) apply (no options, no letter answer key) → "numerical".
When it IS "single", populate options from the (1)(2)(3)(4) labels + their values.

A2) PURE NUMERICAL. A question is "numerical" ONLY when ALL of these hold:
   - The prompt has blanks ("____", "_____").
   - There are NO (1)(2)(3)(4) option labels with values for THIS question.
   - The answer key gives a bare number (not a letter).
In that case, "options":[] ALWAYS.

B) OPTIONS MAY BE DETACHED. In JEE/NEET-style 2-column layouts the question text \
sits at the top of a page but the OPTION VALUES are extracted as separate short \
fragments at the bottom (because they were stored as inline equation images). \
Match those back to questions by position. The first 4 fragments after Q1's text \
are Q1's options (labeled (1), (2), (3), (4)). The next 4 after Q2 are Q2's. \
Look for patterns like "(1) value" or standalone values near question boundaries.

B2) OPTION IDs ARE ALWAYS "A", "B", "C", "D". If the source PDF uses (1), (2), \
(3), (4) as labels, you MUST still output them as id="A", id="B", id="C", id="D" \
in the JSON. The student sees A/B/C/D in the quiz UI; mapping happens here, \
NOT on the frontend.

C) MATH PRESERVATION. Equations in the source may appear as bare symbols like \
"π√LC", "io", "α/10" because they were OCR'd from inline images. Preserve them \
VERBATIM — do NOT try to "fix" them. Optionally wrap them in $...$ LaTeX if \
you're confident: e.g. "π√LC" → "$\\\\pi\\\\sqrt{{LC}}$", "α/10" → "$\\\\alpha/10$". \
When in doubt, keep the raw text — we render with KaTeX on the client.

D) DIAGRAMS — MANDATORY WHEN REFERENCED. If the question says any of these \
phrases, the question is FIGURE-DEPENDENT and you MUST include the matching \
diagram ID(s) in the "diagramRefs" array:
   - "as shown in the figure"
   - "in the given circuit"
   - "shown in the figure"
   - "in the figure"
   - "the values of X and Y are shown in the figure"
   - "from the figure" / "given figure"
The diagram IDs are EXPLICITLY listed in each page's prompt section under \
"Embedded diagrams on this page:" — copy the EXACT strings from there. \
If the question references a figure but no diagram IDs are listed for that \
page, return diagramRefs: [] anyway and set prompt to note "(diagram missing)".

E) ANSWER KEY — MANDATORY. The structured input below includes an "ANSWER KEY" \
section (if present in the PDF). USE IT. For every question:
   - "single"    → set "correctAnswerId" to the letter A/B/C/D from the answer key.
                    The key uses (1)/(2)/(3)/(4) format; map 1→A, 2→B, 3→C, 4→D.
                    DO NOT leave correctAnswerId blank when the answer key has it.
   - "multiple"  → set "correctAnswerIds" to the array of letters.
   - "numerical" → set "numericalAnswer" to the numeric value (parse it: 50, 3.14,
                    2512, 314, etc.). Set "numericalTolerance" to 0 for exact
                    integers; 0.01 if the answer involves π=3.14.
   - If the answer key is missing for a question, leave the field empty (""
                    or [] or null) — but TRY HARD to populate it.

F) TYPE INFERENCE — apply in THIS order (most specific first):
   1. ANSWER KEY gives a LETTER (e.g. "(2)", "(3)", "4") → "single" MCQ. \
      This OVERRIDES blanks in the prompt. Populate options from (1)(2)(3)(4).
   2. (1)(2)(3)(4) labels WITH VALUES appear near the question → "single" MCQ. \
      Even if the prompt has blanks. Populate options from those labels+values.
   3. "Select all that apply" / "Which of the following are" AND answer key \
      has multiple letters → "multiple".
   4. The prompt contains blank(s) "____" AND no options exist AND \
      the answer key gives a bare number → "numerical", options=[].
   5. Answer key gives a single integer/decimal (not a letter) with no \
      (1)(2)(3)(4) options → "numerical".
   6. Otherwise → "single" (default for MCQs without blanks).

G) ANALYZE THE WHOLE DOCUMENT FIRST. Before emitting JSON, mentally scan the \
entire source end-to-end. Identify:
   - The full question list (Q1, Q2, ...)
   - Where the answer key lives (usually last 1-2 pages, sometimes interleaved)
   - Which pages have diagrams (the structured per-page section tells you)
   - The mapping from each Q to its answer key entry (1→Q1, 2→Q2, etc.)
Then produce the JSON in ONE pass.

═══════════════════════════════════════════════════════════════════════════════════

For each question, capture:
- "type": one of "single" | "multiple" | "numerical" (rule F above).
- "prompt": the question text EXACTLY as it appears (see rule C for math).
            Include the figure-reference phrase verbatim ("as shown in the figure").
- "options": array of {{"id":"A"|"B"|"C"|"D", "text":"..."}}. For "single"/"multiple" \
  with 4 choices, populate all 4 (in label order, ids ALWAYS A/B/C/D per rule B2). \
  For "numerical" — always [].
- "correctAnswerId": letter for "single". "" if no answer key is visible.
- "correctAnswerIds": array of letters for "multiple". [] if no answer key is visible.
- "numericalAnswer": the number for "numerical". null if not visible.
- "numericalTolerance": 0 for exact integers; 0.01 when the answer key shows "π = 3.14" \
  or similar approximations. Default 0.
- "pageNumber": 1-based page index where the question appears (use "--- Page N ---" markers).
- "diagramRefs": diagram ids from the input. MANDATORY non-empty for figure-dependent
                questions (rule D). [] if the question doesn't reference a figure.
- "topic": short subject-area string (e.g. "Alternating Current"). null if unclear.

Return ONLY valid JSON matching this schema (no markdown, no explanation):
{{
  "questions": [
    {{<one of the three shapes above>}}
  ]
}}

Rules:
- Extract at most {n} questions (the user requested this many).
- Only extract questions that genuinely appear in the source. Do NOT \
  invent questions to fill the quota — return fewer if the source has fewer.
- If a question has BOTH blanks AND (1)(2)(3)(4) option labels with values, \
  check the ANSWER KEY FIRST: a letter answer like (2) means it's "single" MCQ \
  (populate options from the labels+values). Only classify as "numerical" if \
  there are NO (1)(2)(3)(4) options AND the answer key is a bare number.
- Preserve LaTeX math delimiters (\\(...\\), \\\\[...\\\\], $$, $) when confident.
- Do NOT include any text outside the JSON object.
"""


async def extract_questions_from_pdf(
    *,
    text: str,
    diagrams: dict[str, dict],
    num_questions: int,
    api_keys: list[str],
    llm_client: LLMClient,
    pages: list[str] | None = None,
    page_layouts: list[dict] | None = None,
) -> Quiz:
    """Extract verbatim questions from a PDF instead of generating new ones.

    The LLM is asked to identify questions that already exist in the
    source document and return them with their original wording. This is
    cheaper than generation (no question synthesis needed) and useful
    for students who want to practice the actual exam paper rather
    than new questions on the same topic.

    Each question is tagged with ``source_mode="extracted"`` and a
    ``page_number`` so the UI can display the provenance.

    ``num_questions``: max questions to extract. Pass ``-1`` to mean "all
    questions in the PDF" — the prompt instructs the LLM to return every
    genuine question it finds (still capped by a safety ceiling of 200
    so a runaway scan can't burn thousands of tokens).

    ``page_layouts``: optional per-page bbox data
    (``[{page_number, question_ys, figure_ys}, ...]``) used by the
    backfill step to assign each figure to the question whose text is
    vertically nearest to it. This overrides the LLM's often-wrong
    over-broad diagramRefs.
    """
    # -1 sentinel = "all questions". Use 200 as a hard safety ceiling.
    effective_n = 200 if num_questions == -1 else num_questions

    # If the caller did not pass an explicit answer key, try to extract
    # one from the source text heuristically (looks for "ANSWERS AND
    # SOLUTIONS" or "ANSWER KEY" headers — JEE/NEET/NCERT convention).
    answer_key_text = ""
    if not pages:
        # No structured pages → we only have the raw text. Search it
        # for the answer-key header and grab everything after it.
        marker = None
        for m in ("ANSWERS AND SOLUTIONS", "ANSWER KEY", "ANSWER  KEY"):
            idx = text.upper().find(m)
            if idx >= 0:
                marker = idx
                break
        if marker is not None:
            answer_key_text = text[marker:]
    else:
        # We have structured pages — extract from those instead so we
        # don't include question text twice.
        from app.services.pdf_processor import PageBlocks
        # The caller passed a single concatenated "pages" string; we need
        # the structured PageBlocks to detect answer-key pages. In our
        # current flow the upload router already stripped the answer-key
        # page from the structured input, so the heuristic falls back to
        # raw text. Leave answer_key_text empty here unless we can find
        # a marker in the concatenated pages string.
        upper_pages = "\n".join(pages).upper()
        for m in ("ANSWERS AND SOLUTIONS", "ANSWER KEY"):
            idx = upper_pages.find(m)
            if idx >= 0:
                # Find the offset in the original concatenated string
                # where the answer-key page began. The simplest signal:
                # the prompt section for the answer-key page begins with
                # "--- Page N (answer key) ---" if extract_answer_key
                # was used; otherwise the marker is just in the middle
                # of one page's text. Fall back to including the whole
                # remainder of the page text.
                answer_key_text = "\n".join(pages)[idx:]
                break

    prompt = _build_extract_prompt(
        n=effective_n,
        text=text,
        pages=pages,
        all_questions=(num_questions == -1),
        answer_key=answer_key_text,
    )
    prompt_parts: list = [prompt]

    resp = await llm_client.generate(api_keys=api_keys, prompt_parts=prompt_parts)
    parsed = _parse_extracted_json(resp.text)
    if parsed is None:
        raise QuizValidationError(
            "LLM response not valid JSON for question extraction."
        )

    # Build the diagrams dict from any references the model included.
    referenced_ids: set[str] = set()
    raw_questions = parsed.get("questions", [])
    if not isinstance(raw_questions, list):
        raw_questions = []

    questions: list[Question] = []
    valid_diagram_ids: set[str] = set(diagrams.keys()) if isinstance(diagrams, dict) else set()
    for i, q in enumerate(raw_questions):
        if not isinstance(q, dict):
            continue
        try:
            question = _build_question_from_dict(
                q,
                # For extract we DO validate diagram ids against the
                # diagrams dict now — the upload router sends us the full
                # set, and we want the LLM to be able to reference
                # real diagram IDs in its output.
                valid_diagram_ids=valid_diagram_ids,
                idx=i,
            )
        except _SkipQuestion as exc:
            logger.warning("Skipping malformed extracted question %d: %s", i, exc)
            continue

        # The extract path uses deterministic ids so the UI can group by source.
        question.id = f"q-extracted-{i + 1}"
        # Provenance tags — surfaced in the UI as a chip.
        question.source_mode = "extracted"
        if isinstance(q.get("pageNumber"), int):
            question.page_number = q["pageNumber"]

        # Backfill answer key from the source text. Weaker LLMs
        # (e.g. MiniMax MiMo) sometimes skip rule E even when the
        # answer key is in the prompt. Don't trust the LLM — re-derive
        # the answer from the source text deterministically.
        _backfill_answer_key(
            question,
            question_index=i,
            source_text=text,
        )

        questions.append(question)

    # Diagram assignment as a second pass. We need GLOBAL visibility —
    # the LLM often returns the wrong diagram_ids (e.g. tags BOTH
    # figures on every figure-question) and a per-question decision
    # can't disambiguate. Build a map of figure→question by Y-coord.
    if page_layouts and diagrams:
        _assign_diagrams_by_position(
            questions=questions,
            diagrams=diagrams,
            page_layouts=page_layouts,
        )

    # Build the set of referenced diagram IDs for the final Quiz.
    referenced_ids: set[str] = set()
    for question in questions:
        if question.diagram_ids:
            referenced_ids.update(question.diagram_ids)

    return Quiz(
        id=str(uuid.uuid4()),
        questions=questions,
        diagrams={did: Diagram(**diagrams[did]) for did in referenced_ids if did in diagrams},
    )


def _assign_diagrams_by_position(
    *,
    questions: list,
    diagrams: dict[str, dict],
    page_layouts: list[dict],
) -> None:
    """Assign each figure to its real question using Y-coordinate proximity.

    Replaces whatever the LLM put in ``question.diagram_ids`` with a
    deterministic layout-based assignment:

    1. Group questions by page.
    2. For each page with figures, sort the figures top-to-bottom.
    3. For each question in order, find the figure whose centroid Y
       sits closer to that question's text than to the next question's.
    4. A figure already claimed by a previous question is SKIPPED by
       later questions — prevents the same figure going on every
       question (the bug we are trying to fix).
    5. If a question has no figure in its row, it gets no diagram.

    Mutates each ``question.diagram_ids`` in place.
    """
    # Index layouts by page number for O(1) lookup.
    layouts_by_page: dict[int, dict] = {
        pl.get("page_number"): pl
        for pl in page_layouts
        if isinstance(pl.get("page_number"), int)
    }

    # Group question indices by page so we can do per-page assignment.
    questions_by_page: dict[int, list[int]] = {}
    for i, q in enumerate(questions):
        pg = q.page_number if isinstance(q.page_number, int) else 1
        questions_by_page.setdefault(pg, []).append(i)

    for page_num, q_indices in questions_by_page.items():
        layout = layouts_by_page.get(page_num)
        if not layout:
            continue
        question_ys = layout.get("question_ys") or []
        figure_ys_raw = layout.get("figure_ys") or []
        # Dedupe figure positions (some PDFs report same image twice).
        seen: set[tuple[float, float]] = set()
        figure_ys: list[dict] = []
        for fy in figure_ys_raw:
            key = (fy["y0"], fy["y1"])
            if key in seen:
                continue
            seen.add(key)
            figure_ys.append(fy)

        if not question_ys or not figure_ys:
            continue

        # Sort figures top-to-bottom (so figure-1 is the topmost).
        figure_ys_sorted = sorted(figure_ys, key=lambda f: f["y0"])

        # Track which figures have already been claimed.
        used_figure_indices: set[int] = set()

        # Build absolute diagram IDs available on this page (ordered).
        page_diagrams_ordered: list[str] = []
        for did, d in diagrams.items():
            if isinstance(d, dict) and d.get("page") == page_num:
                page_diagrams_ordered.append(did)

        # For each question on this page (in order), assign the first
        # unclaimed figure whose centroid sits closer to this question
        # than to the next. If no such figure, skip.
        for seq_i, q_idx in enumerate(q_indices):
            q = questions[q_idx]
            if 0 <= q_idx < len(question_ys):
                q_y = question_ys[q_idx]
                q_y0 = q_y["y0"]
                q_y1 = q_y["y1"]
            else:
                # Question index out of bounds (rare). Skip.
                continue

            # Find next question's y0 (or fall through to page bottom).
            if seq_i + 1 < len(q_indices):
                nxt_idx = q_indices[seq_i + 1]
                if 0 <= nxt_idx < len(question_ys):
                    next_q_y0 = question_ys[nxt_idx]["y0"]
                else:
                    next_q_y0 = q_y1 + 10**9
            else:
                next_q_y0 = q_y1 + 10**9

            # Try to find a figure strictly in this row, prefer the
            # topmost unclaimed one. If none strictly in row, find the
            # nearest figure ABOVE this question that hasn't been claimed.
            assigned_idx: int | None = None
            # Pass 1: figures strictly between q_y1 and next_q_y0 (unclaimed).
            for i, fy in enumerate(figure_ys_sorted):
                if i in used_figure_indices:
                    continue
                f_cy = (fy["y0"] + fy["y1"]) / 2
                # Must be after the current question end AND before the
                # next question start (or the page bottom).
                if f_cy > q_y1 and f_cy < next_q_y0:
                    assigned_idx = i
                    break
            # Pass 2: figures whose centroid is in (q_y0, q_y1] range
            # (figure partly overlaps with question text, common for
            # inline equations drawn as images).
            if assigned_idx is None:
                for i, fy in enumerate(figure_ys_sorted):
                    if i in used_figure_indices:
                        continue
                    f_cy = (fy["y0"] + fy["y1"]) / 2
                    if f_cy > q_y0 and f_cy <= q_y1:
                        assigned_idx = i
                        break
            # Pass 3: nearest ABOVE-q question — handles a figure placed
            # BEFORE its question text but AFTER the previous question.
            if assigned_idx is None:
                best_dist = float("inf")
                for i, fy in enumerate(figure_ys_sorted):
                    if i in used_figure_indices:
                        continue
                    if fy["y1"] > q_y0:
                        continue  # not above
                    # Distance from figure bottom to question top
                    d = q_y0 - fy["y1"]
                    if d < best_dist:
                        best_dist = d
                        assigned_idx = i

            if assigned_idx is None:
                # No figure available for this question. Clear whatever
                # the LLM tagged so we don't show wrong diagrams.
                q.diagram_ids = []
                continue

            used_figure_indices.add(assigned_idx)

            # Resolve the relative figure-N index to an absolute
            # page-N-figure-N id. Use the diagrams dict ordering.
            # `assigned_idx` is the sorted-position index (0-based).
            # Try absolute id first.
            target_abs_id = f"page-{page_num}-figure-{assigned_idx + 1}"
            if target_abs_id in diagrams:
                q.diagram_ids = [target_abs_id]
            elif assigned_idx < len(page_diagrams_ordered):
                q.diagram_ids = [page_diagrams_ordered[assigned_idx]]
            else:
                q.diagram_ids = []


def _backfill_answer_key(
    question,
    question_index: int,
    source_text: str,
) -> None:
    """Backfill the answer-key field from the source text. Lighter than
    the original combined backfill — we only do the answer-key piece
    here, because diagram assignment moved to ``_assign_diagrams_by_position``.
    """
    # The question's 1-based number in the PDF (we use the index + 1
    # because we don't have a stable per-question id from the LLM).
    qnum = question_index + 1

    # ── Answer key ───────────────────────────────────────────────────────
    # Patterns (after the "ANSWERS AND SOLUTIONS" header):
    #   "1. (2)"   → Q1 answer = option (2) = letter B
    #   "2. 50"    → Q2 answer = 50 (numerical)
    #   "4. (3)"   → Q4 answer = option (3) = letter C
    # IMPORTANT: search ONLY the answer-key section. Without that, the
    # regex matches option labels "(1)\n(2)\n(3)\n(4)" that appear in
    # the question text and gives the WRONG answer.
    ak_idx = source_text.upper().find("ANSWERS AND SOLUTIONS")
    if ak_idx >= 0:
        answer_key_section = source_text[ak_idx:]
    else:
        answer_key_section = source_text
    ans_re = re.compile(
        rf"(?<!\d){qnum}\s*[\.\)]\s*"
        r"(\(\s*([1-4A-Da-d])\s*\)|([0-9]+(?:\.[0-9]+)?))"
    )
    m = ans_re.search(answer_key_section)
    if m:
        import logging
        logging.getLogger("backfill").info(
            "Q%d backfill: matched %r in answer key section", qnum, m.group(0)
        )
        # Letter answer: matched in group 1 as "(X)"
        if m.group(2):
            token = m.group(2).upper()
            letter = _normalize_letter_token(token)
            if question.type == "single" and letter in {o.id for o in question.options}:
                if not question.correct_answer_id:
                    question.correct_answer_id = letter
        # Numeric answer: matched in group 3
        elif m.group(3):
            try:
                num = float(m.group(3))
                if question.type == "numerical" and question.numerical_answer is None:
                    question.numerical_answer = num
                    # Heuristic: if the answer has π nearby, set 0.01 tol
                    if "π" in m.group(0) or "pi" in m.group(0).lower():
                        question.numerical_tolerance = 0.01
            except ValueError:
                pass


def _build_extract_prompt(
    *,
    n: int,
    text: str,
    pages: list[str] | None = None,
    all_questions: bool = False,
    answer_key: str = "",
) -> str:
    """Wrap the system prompt + source text. We prefix the source with
    "Page N:" markers so the LLM can cite page numbers in its output.

    When ``pages`` (structured per-page text from the PDF processor) is
    provided, we append it as a clearly-labeled section so the LLM can
    see the option-value fragments that may be detached from their
    question text in 2-column layouts. Each page's section also lists
    the diagram IDs extracted from that page so the LLM can reference
    them in ``diagramRefs``.

    When ``answer_key`` is non-empty (text from the "ANSWERS AND
    SOLUTIONS" page(s) of the source), we prepend it as its own
    clearly-labeled section so the LLM can populate
    ``correctAnswerId`` / ``numericalAnswer`` from it (rule E).

    When ``all_questions=True`` (the "All" button in exact mode), the
    cap clause is relaxed so the LLM returns every genuine question in
    the source instead of stopping at ``n``.
    """
    # The PDF text from the extractor already contains "Page N:" markers
    # (see extract_text in pdf_processor.py). If they're missing, the
    # pageNumber field will simply be None.
    base = _EXTRACT_SYSTEM.format(n=n)
    if answer_key:
        # Place the answer key BEFORE the source document so the LLM
        # sees it first. Many weaker models under-attend rules buried
        # mid-prompt; surfacing the key up-front dramatically improves
        # correctAnswerId / numericalAnswer population.
        base += (
            "\n\n════════════════════════════════════════════════════════════════════\n"
            "ANSWER KEY (from the source PDF — USE THIS. Mapping guide:\n"
            "    1. (2)     → Q1's answer is option (2) = letter B\n"
            "    2. 50      → Q2's answer is 50 (numerical)\n"
            "    4. (3)     → Q4's answer is option (3) = letter C\n"
            "    5. (3)     → Q5's answer is option (3) = letter C)\n\n"
            "MANDATORY: For every question, populate the answer field from this\n"
            "key per rule E. NEVER leave correctAnswerId/numericalAnswer blank\n"
            "if the key has the answer.\n"
            "════════════════════════════════════════════════════════════════════\n\n"
            + answer_key
        )
    base += "\n\nSource document:\n\n" + text
    if all_questions:
        base += (
            "\n\nALL-QUESTIONS MODE: The user selected 'All questions in this PDF'. "
            f"Extract EVERY question that genuinely appears in the source (hard cap: {n}). "
            "Do NOT truncate early. Do NOT invent questions. "
            "If the source has more than the cap, extract the first N you encounter."
        )
    if pages:
        structured = "\n\n---\n\nSTRUCTURED PER-PAGE TEXT (with option-value fragments separated AND diagram IDs):\n\n"
        for i, page_text in enumerate(pages, 1):
            structured += f"=== Structured Page {i} ===\n{page_text}\n\n"
        base += structured
    return base


def _parse_extracted_json(raw: str) -> dict | None:
    """Parse the JSON envelope returned by the extraction LLM call.

    Mirrors the tolerant parsing in ``generate_quiz`` — we strip code
    fences, locate the outer ``{...}`` for the questions array, and
    json.loads it. Returns ``None`` if no parseable envelope is found
    so the caller can raise a structured ``QuizValidationError``.
    """
    from app.services.quiz_generator import _parse_quiz_json  # local import to avoid cycle

    text = raw.strip()
    # Strip code fences the LLM sometimes adds despite instructions.
    if text.startswith("```"):
        text = text.split("```", 2)[1] if "```" in text else text
        text = text.lstrip("json").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try the tolerant parse_quiz_json helper which can recover from
    # trailing junk and code fences.
    cleaned = _parse_quiz_json(text, [])
    if cleaned:
        return {"questions": cleaned}
    return None


# ── Solve ──────────────────────────────────────────────────────────────────────

@dataclass
class SolveResult:
    """The outcome of a solve call. Returned by ``solve_question`` so
    callers can both display the prose solution AND cross-check the
    answer letter against what the quiz generator originally stored.
    """

    text: str
    parsed_answer: str | None = None  # letter parsed from the trailing
    # "Answer: X" line; None if absent or unparseable.


async def solve_question(
    *,
    question: str,
    options: list[QuestionOption],
    diagrams: list[dict],
    api_keys: list[str],
    llm_client: LLMClient,
    question_type: str = "single",
) -> SolveResult:
    """Return a step-by-step solution plus the answer the solver arrived at.

    The caller (``/quiz/solve`` router) compares the parsed answer against
    the original ``correct_answer_id`` to detect hallucinations at
    quiz-generation time. The answer-line format is chosen based on
    ``question_type``:
      - "single"    → "Answer: X"
      - "multiple"  → "Answer: X, Y"
      - "numerical" → "Answer: <number>"
    """
    answer_format = _SOLVE_ANSWER_FORMAT.get(
        question_type, _SOLVE_ANSWER_FORMAT["single"]
    )
    system = _SOLVE_SYSTEM + "\n\n" + answer_format

    option_text = (
        "\n".join(f"  {o.id}. {o.text}" for o in options) if options else "(no options)"
    )
    prompt_text = f"{system}\n\nQuestion: {question}\n\nOptions:\n{option_text}"

    prompt_parts: list = [prompt_text]
    prompt_parts.extend(build_image_parts(diagrams))

    resp = await llm_client.generate(api_keys=api_keys, prompt_parts=prompt_parts)
    return SolveResult(text=resp.text, parsed_answer=parse_solver_answer(resp.text))


# ── Chat ───────────────────────────────────────────────────────────────────────

async def chat_about_question(
    *,
    question: str,
    options: list[QuestionOption],
    diagrams: list[dict],
    prior_messages: list[ChatMessage],
    new_message: str,
    api_keys: list[str],
    llm_client: LLMClient,
) -> str:
    """Return an assistant reply to the student's chat message."""
    # Cap history
    capped = prior_messages[-settings.CHAT_HISTORY_LIMIT:]

    # Build context
    option_text = "\n".join(f"  {o.id}. {o.text}" for o in options) if options else "(no options)"
    context = f"{_CHAT_SYSTEM}\n\nQuestion: {question}\n\nOptions:\n{option_text}"

    prompt_parts: list = [context]
    prompt_parts.extend(build_image_parts(diagrams))

    # Append history
    for msg in capped:
        prefix = "Student" if msg.role == "user" else "Tutor"
        prompt_parts.append(f"\n{prefix}: {msg.content}")

    prompt_parts.append(f"\nStudent: {new_message}\nTutor:")

    resp = await llm_client.generate(api_keys=api_keys, prompt_parts=prompt_parts)
    return resp.text
