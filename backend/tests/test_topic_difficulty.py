"""Tests for topic extraction, difficulty levels, and smart question controls."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from app.models.schemas import (
    Question,
    QuestionOption,
    Quiz,
    QuizGenerateRequest,
)
from app.services.llm_client import LLMResponse
from app.services.quiz_generator import (
    _build_quiz_prompt,
    _parse_quiz_json,
    generate_quiz,
)

# ── Sample JSON with topic field ──────────────────────────────────────────────

SAMPLE_JSON_WITH_TOPIC = json.dumps({
    "questions": [
        {
            "prompt": "What is 2+2?",
            "options": [
                {"id": "A", "text": "3"},
                {"id": "B", "text": "4"},
                {"id": "C", "text": "5"},
                {"id": "D", "text": "6"},
            ],
            "correctAnswerId": "B",
            "diagramRefs": [],
            "topic": "Arithmetic",
        }
    ]
})

SAMPLE_JSON_WITHOUT_TOPIC = json.dumps({
    "questions": [
        {
            "prompt": "What is the capital of France?",
            "options": [
                {"id": "A", "text": "London"},
                {"id": "B", "text": "Paris"},
                {"id": "C", "text": "Berlin"},
                {"id": "D", "text": "Madrid"},
            ],
            "correctAnswerId": "B",
            "diagramRefs": [],
        }
    ]
})

# ── Topic extraction in parsing ───────────────────────────────────────────────

class TestTopicParsing:
    def test_topic_extracted(self):
        qs = _parse_quiz_json(SAMPLE_JSON_WITH_TOPIC, set())
        assert len(qs) == 1
        assert qs[0].topic == "Arithmetic"

    def test_topic_defaults_to_none(self):
        qs = _parse_quiz_json(SAMPLE_JSON_WITHOUT_TOPIC, set())
        assert len(qs) == 1
        assert qs[0].topic is None

    def test_topic_in_question_model(self):
        q = Question(
            id="q1",
            prompt="What?",
            options=[QuestionOption(id="A", text="Yes")],
            correct_answer_id="A",
            topic="Physics",
        )
        assert q.topic == "Physics"

    def test_topic_optional_in_question_model(self):
        q = Question(
            id="q1",
            prompt="What?",
            options=[QuestionOption(id="A", text="Yes")],
            correct_answer_id="A",
        )
        assert q.topic is None

# ── Difficulty prompt construction ────────────────────────────────────────────

class TestDifficultyPrompt:
    def test_easy_difficulty(self):
        prompt = _build_quiz_prompt(n=5, difficulty="easy")
        assert "basic recall and straightforward application" in prompt

    def test_medium_difficulty(self):
        prompt = _build_quiz_prompt(n=5, difficulty="medium")
        assert "requires understanding and multi-step reasoning" in prompt

    def test_hard_difficulty(self):
        prompt = _build_quiz_prompt(n=5, difficulty="hard")
        assert "complex problems requiring deep analysis" in prompt

    def test_mixed_difficulty(self):
        prompt = _build_quiz_prompt(n=5, difficulty="mixed")
        assert "Vary difficulty across questions" in prompt

    def test_default_is_mixed(self):
        prompt = _build_quiz_prompt(n=5)
        assert "Vary difficulty across questions" in prompt

    def test_unknown_difficulty_defaults_to_mixed(self):
        prompt = _build_quiz_prompt(n=5, difficulty="unknown")
        assert "Vary difficulty across questions" in prompt

# ── Focus topics in prompt ────────────────────────────────────────────────────

class TestFocusTopics:
    def test_single_topic(self):
        prompt = _build_quiz_prompt(n=5, focus_topics=["Algebra"])
        assert '"Algebra"' in prompt
        assert "Generate questions ONLY about these topics" in prompt

    def test_multiple_topics(self):
        prompt = _build_quiz_prompt(n=5, focus_topics=["Algebra", "Calculus"])
        assert '"Algebra"' in prompt
        assert '"Calculus"' in prompt

    def test_no_focus_topics(self):
        prompt = _build_quiz_prompt(n=5, focus_topics=None)
        assert "Generate questions ONLY about these topics" not in prompt

    def test_empty_focus_topics(self):
        prompt = _build_quiz_prompt(n=5, focus_topics=[])
        assert "Generate questions ONLY about these topics" not in prompt

# ── Question types in prompt ──────────────────────────────────────────────────

class TestQuestionTypes:
    def test_single_type(self):
        prompt = _build_quiz_prompt(n=5, question_types=["conceptual"])
        assert '"conceptual"' in prompt
        assert "Include these types of questions" in prompt

    def test_multiple_types(self):
        prompt = _build_quiz_prompt(n=5, question_types=["conceptual", "numerical"])
        assert '"conceptual"' in prompt
        assert '"numerical"' in prompt

    def test_no_question_types(self):
        prompt = _build_quiz_prompt(n=5, question_types=None)
        assert "Include these types of questions" not in prompt

    def test_empty_question_types(self):
        prompt = _build_quiz_prompt(n=5, question_types=[])
        assert "Include these types of questions" not in prompt

# ── Full prompt construction ──────────────────────────────────────────────────

class TestFullPrompt:
    def test_all_options_combined(self):
        prompt = _build_quiz_prompt(
            n=10,
            difficulty="hard",
            focus_topics=["Thermodynamics", "Kinetics"],
            question_types=["numerical", "diagram-based"],
        )
        assert "10" in prompt
        assert "complex problems requiring deep analysis" in prompt
        assert '"Thermodynamics"' in prompt
        assert '"Kinetics"' in prompt
        assert '"numerical"' in prompt
        assert '"diagram-based"' in prompt
        assert "topic" in prompt.lower()

# ── QuizGenerateRequest schema ────────────────────────────────────────────────

class TestQuizGenerateRequestExtended:
    def test_default_difficulty(self):
        r = QuizGenerateRequest(text="hello", diagrams={}, api_keys=["k1"])
        assert r.difficulty == "mixed"
        assert r.focus_topics is None
        assert r.question_types is None

    def test_custom_difficulty(self):
        r = QuizGenerateRequest(text="hello", diagrams={}, api_keys=["k1"], difficulty="hard")
        assert r.difficulty == "hard"

    def test_focus_topics(self):
        r = QuizGenerateRequest(
            text="hello", diagrams={}, api_keys=["k1"],
            focus_topics=["Algebra", "Geometry"],
        )
        assert r.focus_topics == ["Algebra", "Geometry"]

    def test_question_types(self):
        r = QuizGenerateRequest(
            text="hello", diagrams={}, api_keys=["k1"],
            question_types=["conceptual", "numerical"],
        )
        assert r.question_types == ["conceptual", "numerical"]

# ── Integration: generate_quiz with new params ───────────────────────────────

class TestGenerateQuizWithNewParams:
    @pytest.mark.asyncio
    async def test_difficulty_passed_to_prompt(self):
        mock_client = AsyncMock()
        mock_client.generate = AsyncMock(return_value=LLMResponse(text=SAMPLE_JSON_WITH_TOPIC))

        quiz = await generate_quiz(
            text="Some text",
            diagrams={},
            num_questions=1,
            api_keys=["k1"],
            llm_client=mock_client,
            difficulty="hard",
        )
        assert len(quiz.questions) == 1
        # Verify the prompt passed to the LLM contains difficulty instruction
        call_args = mock_client.generate.call_args
        prompt_parts = call_args.kwargs["prompt_parts"]
        assert "complex problems requiring deep analysis" in prompt_parts[0]

    @pytest.mark.asyncio
    async def test_focus_topics_passed_to_prompt(self):
        mock_client = AsyncMock()
        mock_client.generate = AsyncMock(return_value=LLMResponse(text=SAMPLE_JSON_WITH_TOPIC))

        quiz = await generate_quiz(
            text="Some text",
            diagrams={},
            num_questions=1,
            api_keys=["k1"],
            llm_client=mock_client,
            focus_topics=["Algebra"],
        )
        call_args = mock_client.generate.call_args
        prompt_parts = call_args.kwargs["prompt_parts"]
        assert '"Algebra"' in prompt_parts[0]

    @pytest.mark.asyncio
    async def test_question_types_passed_to_prompt(self):
        mock_client = AsyncMock()
        mock_client.generate = AsyncMock(return_value=LLMResponse(text=SAMPLE_JSON_WITH_TOPIC))

        quiz = await generate_quiz(
            text="Some text",
            diagrams={},
            num_questions=1,
            api_keys=["k1"],
            llm_client=mock_client,
            question_types=["numerical"],
        )
        call_args = mock_client.generate.call_args
        prompt_parts = call_args.kwargs["prompt_parts"]
        assert '"numerical"' in prompt_parts[0]

    @pytest.mark.asyncio
    async def test_topic_preserved_in_quiz(self):
        mock_client = AsyncMock()
        mock_client.generate = AsyncMock(return_value=LLMResponse(text=SAMPLE_JSON_WITH_TOPIC))

        quiz = await generate_quiz(
            text="Some text",
            diagrams={},
            num_questions=1,
            api_keys=["k1"],
            llm_client=mock_client,
        )
        assert quiz.questions[0].topic == "Arithmetic"
