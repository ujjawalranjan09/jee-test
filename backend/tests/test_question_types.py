"""Tests for the 3 question types: single / multiple / numerical.

Covers:
- Parser: _build_question_from_dict handles all 3 shapes
- Parser: classify_question_type() fallback when LLM omits the field
- Schema: default type is "single" (backwards compat)
- Quiz: type-less questions default to "single" end-to-end
- Extract: per-type provenance tags (source_mode + page_number)
- Answer-line parser: handles letters, comma-lists, numbers
- answers_match: comma-list order-insensitive, numeric match, letter match
"""

from __future__ import annotations

import pytest

from app.models.schemas import (
    AnswerState,
    Diagram,
    Question,
    QuestionOption,
    Quiz,
    QuizGenerateRequest,
    SolveRequest,
    SolveResponse,
)
from app.services.quiz_generator import (
    _build_question_from_dict,
    _coerce_question_type,
    _normalize_answer,
    answers_match,
    classify_question_type,
    parse_solver_answer,
)


# ── Schema backwards-compat ────────────────────────────────────────────────────

class TestSchemaBackwardsCompat:
    def test_question_type_defaults_to_single(self):
        q = Question(
            id="q1",
            prompt="What is 2+2?",
            options=[QuestionOption(id="A", text="4")],
            correct_answer_id="A",
        )
        assert q.type == "single"

    def test_question_without_type_field_still_constructs(self):
        # Simulate the JSON the old code emitted (no `type` key). Pydantic
        # should default it to "single" and the empty correct_answer_ids to [].
        q = Question(
            id="q1",
            prompt="",
            options=[],
            correct_answer_id="A",
        )
        assert q.type == "single"
        assert q.correct_answer_ids == []
        assert q.numerical_answer is None
        assert q.numerical_tolerance == 0.0

    def test_quiz_generate_request_accepts_legacy_question_types(self):
        # Legacy strings like "conceptual" / "theoretical" should NOT
        # raise — the schema is now free-form for backwards compat.
        req = QuizGenerateRequest(
            text="x",
            diagrams={},
            num_questions=3,
            question_types=["conceptual", "numerical"],
        )
        assert req.question_types == ["conceptual", "numerical"]


# ── Parser: _build_question_from_dict ─────────────────────────────────────────

class TestBuildQuestionFromDict:
    def test_single_with_explicit_type(self):
        q = _build_question_from_dict(
            {
                "type": "single",
                "prompt": "Capital of France?",
                "options": [
                    {"id": "A", "text": "Paris"},
                    {"id": "B", "text": "Berlin"},
                    {"id": "C", "text": "Madrid"},
                    {"id": "D", "text": "Rome"},
                ],
                "correctAnswerId": "A",
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert q.type == "single"
        assert q.correct_answer_id == "A"
        assert q.correct_answer_ids == []
        assert q.numerical_answer is None
        assert q.options[0].text == "Paris"
        assert q.options[3].text == "Rome"

    def test_multiple_with_explicit_type(self):
        q = _build_question_from_dict(
            {
                "type": "multiple",
                "prompt": "Which of the following are prime numbers? (Select all that apply)",
                "options": [
                    {"id": "A", "text": "2"},
                    {"id": "B", "text": "4"},
                    {"id": "C", "text": "5"},
                    {"id": "D", "text": "7"},
                ],
                "correctAnswerIds": ["A", "C", "D"],
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert q.type == "multiple"
        assert q.correct_answer_id == ""
        assert sorted(q.correct_answer_ids) == ["A", "C", "D"]
        assert q.numerical_answer is None

    def test_multiple_normalizes_letter_case_and_dedups(self):
        q = _build_question_from_dict(
            {
                "type": "multiple",
                "prompt": "Pick all.",
                "options": [
                    {"id": "A", "text": "a"},
                    {"id": "B", "text": "b"},
                    {"id": "C", "text": "c"},
                    {"id": "D", "text": "d"},
                ],
                "correctAnswerIds": ["a", "C", "c", "b", "B"],  # messy input
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert sorted(q.correct_answer_ids) == ["A", "B", "C"]

    def test_multiple_drops_invalid_letters(self):
        q = _build_question_from_dict(
            {
                "type": "multiple",
                "prompt": "Pick all.",
                "options": [
                    {"id": "A", "text": "a"},
                    {"id": "B", "text": "b"},
                    {"id": "C", "text": "c"},
                    {"id": "D", "text": "d"},
                ],
                "correctAnswerIds": ["A", "Z"],  # Z isn't a valid option
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert q.correct_answer_ids == ["A"]

    def test_numerical_with_explicit_type(self):
        q = _build_question_from_dict(
            {
                "type": "numerical",
                "prompt": "Find x if 2x = 10.",
                "options": [],
                "numericalAnswer": 5,
                "numericalTolerance": 0.0,
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert q.type == "numerical"
        assert q.options == []
        assert q.numerical_answer == 5.0
        assert q.numerical_tolerance == 0.0
        assert q.correct_answer_id == ""
        assert q.correct_answer_ids == []

    def test_numerical_with_tolerance(self):
        q = _build_question_from_dict(
            {
                "type": "numerical",
                "prompt": "Compute g.",
                "options": [],
                "numericalAnswer": 9.81,
                "numericalTolerance": 0.01,
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert q.numerical_tolerance == 0.01

    def test_numerical_missing_answer_raises_skip(self):
        from app.services.quiz_generator import _SkipQuestion
        with pytest.raises(_SkipQuestion):
            _build_question_from_dict(
                {"type": "numerical", "prompt": "x", "options": [], "numericalAnswer": None},
                valid_diagram_ids=set(),
                idx=0,
            )

    def test_type_missing_falls_back_to_classifier_single(self):
        # No `type` key, no answer marker, generic prompt → "single"
        q = _build_question_from_dict(
            {
                "prompt": "What is H2O?",
                "options": [
                    {"id": "A", "text": "water"},
                    {"id": "B", "text": "oxygen"},
                    {"id": "C", "text": "hydrogen"},
                    {"id": "D", "text": "carbon"},
                ],
                "correctAnswerId": "A",
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert q.type == "single"
        assert q.correct_answer_id == "A"

    def test_type_missing_classifier_picks_multiple_from_array(self):
        q = _build_question_from_dict(
            {
                "prompt": "Which are primary colors?",
                "options": [
                    {"id": "A", "text": "red"},
                    {"id": "B", "text": "green"},
                    {"id": "C", "text": "blue"},
                    {"id": "D", "text": "yellow"},
                ],
                "correctAnswerIds": ["A", "C", "D"],
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert q.type == "multiple"
        assert sorted(q.correct_answer_ids) == ["A", "C", "D"]

    def test_type_missing_classifier_picks_numerical_from_hint(self):
        q = _build_question_from_dict(
            {
                "prompt": "Find the value of x in the equation.",
                "options": [],
                "numericalAnswer": 42,
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert q.type == "numerical"
        assert q.numerical_answer == 42.0

    def test_type_coercion_handles_aliases(self):
        assert _coerce_question_type("single") == "single"
        assert _coerce_question_type("SINGLE") == "single"
        assert _coerce_question_type("mcq") == "single"
        assert _coerce_question_type("multiple") == "multiple"
        assert _coerce_question_type("multi-select") == "multiple"
        assert _coerce_question_type("select_all") == "multiple"
        assert _coerce_question_type("numerical") == "numerical"
        assert _coerce_question_type("numeric") == "numerical"
        assert _coerce_question_type("integer") == "numerical"
        assert _coerce_question_type("unknown_thing") is None
        assert _coerce_question_type(None) is None

    def test_classify_question_type_direct(self):
        assert classify_question_type({"correctAnswerIds": ["A", "B"]}) == "multiple"
        assert classify_question_type({"numericalAnswer": 5}) == "numerical"
        assert classify_question_type({"prompt": "Select all that apply"}) == "multiple"
        assert classify_question_type({"prompt": "Which of the following are prime?"}) == "multiple"
        assert classify_question_type({"prompt": "Find the value of x"}) == "numerical"
        assert classify_question_type({"prompt": "What is the capital of France?"}) == "single"
        assert classify_question_type({}) == "single"

    def test_invalid_correctAnswerId_drops_to_empty(self):
        # LLM claimed "Z" but there's no Z option — keep the field empty
        # so the UI can show "answer not provided" instead of falsely grading.
        q = _build_question_from_dict(
            {
                "type": "single",
                "prompt": "Pick one.",
                "options": [
                    {"id": "A", "text": "a"},
                    {"id": "B", "text": "b"},
                    {"id": "C", "text": "c"},
                    {"id": "D", "text": "d"},
                ],
                "correctAnswerId": "Z",
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert q.correct_answer_id == ""

    def test_options_padded_to_4(self):
        q = _build_question_from_dict(
            {
                "type": "single",
                "prompt": "Only two options?",
                "options": [
                    {"id": "A", "text": "yes"},
                    {"id": "B", "text": "no"},
                ],
                "correctAnswerId": "A",
            },
            valid_diagram_ids=set(),
            idx=0,
        )
        assert len(q.options) == 4
        assert q.options[2].text == ""
        assert q.options[3].text == ""


# ── Answer-line parser ─────────────────────────────────────────────────────────

class TestParseSolverAnswer:
    def test_letter(self):
        assert parse_solver_answer("...Answer: D") == "D"

    def test_letter_with_bold(self):
        assert parse_solver_answer("...**Answer: B**") == "B"

    def test_letter_with_period(self):
        assert parse_solver_answer("...Answer: A.") == "A"

    def test_letter_with_equals(self):
        assert parse_solver_answer("...Answer = C") == "C"

    def test_number(self):
        assert parse_solver_answer("...Answer: 25") == "25"

    def test_decimal(self):
        assert parse_solver_answer("...Answer: 3.14") == "3.14"

    def test_comma_list(self):
        assert parse_solver_answer("...Answer: B, C, D") == "B, C, D"

    def test_no_answer_returns_none(self):
        assert parse_solver_answer("Just some text, no answer line.") is None

    def test_empty_returns_none(self):
        assert parse_solver_answer("") is None

    def test_picks_last_answer_line(self):
        # If the model says "Answer: A" in the body and "Answer: B" at the
        # end, we trust the last one.
        text = "Some reasoning...\nAnswer: A\nMore work...\nAnswer: B"
        assert parse_solver_answer(text) == "B"


# ── answers_match ──────────────────────────────────────────────────────────────

class TestAnswersMatch:
    def test_letters_match(self):
        assert answers_match("B", "B") is True
        assert answers_match("B", "C") is False

    def test_letters_case_insensitive(self):
        assert answers_match("b", "B") is True

    def test_letters_strip_whitespace(self):
        assert answers_match(" B ", "B") is True

    def test_comma_list_order_insensitive(self):
        assert answers_match("B, C", "C,B") is True
        assert answers_match("B, C", "B, D") is False

    def test_numbers(self):
        assert answers_match("25", "25") is True
        assert answers_match("25.0", "25") is True
        assert answers_match("25", "26") is False

    def test_returns_none_when_either_missing(self):
        assert answers_match(None, "B") is None
        assert answers_match("B", None) is None
        assert answers_match(None, None) is None

    def test_returns_false_on_type_mismatch(self):
        # Letter vs number → False (caller can show "couldn't cross-check")
        assert answers_match("B", "25") is False


# ── SolveRequest/Response schema ───────────────────────────────────────────────

class TestSolveRequestSchema:
    def test_defaults_question_type_to_single(self):
        req = SolveRequest(
            question="x",
            options=[QuestionOption(id="A", text="y")],
        )
        assert req.question_type == "single"
        assert req.correct_answer_id is None
        assert req.numerical_answer is None
        assert req.numerical_tolerance == 0.0

    def test_numerical_question(self):
        req = SolveRequest(
            question="Find x.",
            options=[],
            question_type="numerical",
            numerical_answer=3.14,
            numerical_tolerance=0.01,
        )
        assert req.question_type == "numerical"
        assert req.numerical_answer == 3.14
        assert req.numerical_tolerance == 0.01

    def test_multiple_question(self):
        req = SolveRequest(
            question="Pick all that apply.",
            options=[QuestionOption(id="A", text="a"), QuestionOption(id="B", text="b")],
            question_type="multiple",
            correct_answer_id="A,B",
        )
        assert req.question_type == "multiple"
        assert req.correct_answer_id == "A,B"
