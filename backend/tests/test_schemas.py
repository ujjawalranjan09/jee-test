"""Unit tests for Pydantic schemas."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.schemas import (
    AnswerState,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    Diagram,
    ErrorDetail,
    Question,
    QuestionOption,
    Quiz,
    QuizGenerateRequest,
    QuizGenerateResponse,
    SolveRequest,
    SolveResponse,
    UploadResponse,
)

# ── Diagram ────────────────────────────────────────────────────────────────────

class TestDiagram:
    def test_construction(self):
        d = Diagram(id="d1", page=1, image_data="base64data")
        assert d.id == "d1"
        assert d.page == 1
        assert d.image_data == "base64data"

    def test_missing_field(self):
        with pytest.raises(ValidationError):
            Diagram(id="d1", page=1)  # type: ignore

# ── QuestionOption ─────────────────────────────────────────────────────────────

class TestQuestionOption:
    def test_construction(self):
        o = QuestionOption(id="A", text="Paris")
        assert o.id == "A"

    def test_missing_text(self):
        with pytest.raises(ValidationError):
            QuestionOption(id="A")  # type: ignore

# ── Question ───────────────────────────────────────────────────────────────────

class TestQuestion:
    def test_construction(self):
        q = Question(
            id="q1",
            prompt="What?",
            options=[QuestionOption(id="A", text="Yes"), QuestionOption(id="B", text="No")],
            correct_answer_id="A",
        )
        assert q.diagram_ids == []
        assert q.correct_answer_id == "A"

    def test_with_diagrams(self):
        q = Question(
            id="q1",
            prompt="What?",
            options=[QuestionOption(id="A", text="Yes")],
            correct_answer_id="A",
            diagram_ids=["d1"],
        )
        assert q.diagram_ids == ["d1"]

    def test_missing_options(self):
        with pytest.raises(ValidationError):
            Question(id="q1", prompt="What?", correct_answer_id="A")  # type: ignore

# ── Quiz ───────────────────────────────────────────────────────────────────────

class TestQuiz:
    def test_construction(self):
        q = Quiz(
            id="quiz1",
            questions=[
                Question(
                    id="q1", prompt="?", options=[QuestionOption(id="A", text="x")],
                    correct_answer_id="A",
                )
            ],
            diagrams={"d1": Diagram(id="d1", page=1, image_data="abc")},
        )
        assert len(q.questions) == 1
        assert "d1" in q.diagrams

    def test_empty_questions(self):
        q = Quiz(id="quiz1", questions=[], diagrams={})
        assert q.questions == []

# ── AnswerState ────────────────────────────────────────────────────────────────

class TestAnswerState:
    def test_defaults(self):
        a = AnswerState(question_id="q1")
        assert a.selected_option_id is None
        assert a.marked_for_review is False

    def test_full(self):
        a = AnswerState(question_id="q1", selected_option_id="B", marked_for_review=True)
        assert a.selected_option_id == "B"

# ── Upload response ────────────────────────────────────────────────────────────

class TestUploadResponse:
    def test_construction(self):
        r = UploadResponse(text="hello", diagrams={})
        assert r.text == "hello"

# ── Error detail ───────────────────────────────────────────────────────────────

class TestErrorDetail:
    def test_construction(self):
        e = ErrorDetail(error_type="not_pdf", message="Bad file")
        assert e.error_type == "not_pdf"

# ── QuizGenerateRequest ────────────────────────────────────────────────────────

class TestQuizGenerateRequest:
    def test_construction(self):
        r = QuizGenerateRequest(text="hello", diagrams={})
        assert r.num_questions == 10

    def test_missing_text(self):
        # ``text`` is the only strictly required field — keys are server-side now.
        with pytest.raises(ValidationError):
            QuizGenerateRequest(diagrams={})  # type: ignore

# ── SolveRequest ───────────────────────────────────────────────────────────────

class TestSolveRequest:
    def test_construction(self):
        r = SolveRequest(
            question="What?",
            options=[QuestionOption(id="A", text="x")],
        )
        assert r.diagrams == []

# ── ChatRequest ────────────────────────────────────────────────────────────────

class TestChatRequest:
    def test_construction(self):
        r = ChatRequest(
            question="What?",
            message="Explain",
        )
        assert r.prior_messages == []
        assert r.options == []

    def test_missing_message(self):
        with pytest.raises(ValidationError):
            ChatRequest(question="What?")  # type: ignore
