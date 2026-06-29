"""Unit tests for quiz generation logic (Task 8)."""

from __future__ import annotations

import json
import time
from unittest.mock import AsyncMock

import pytest

from app.config import settings
from app.services.llm_client import LLMResponse
from app.services.quiz_generator import (
    QuizGenError,
    _parse_quiz_json,
    generate_quiz,
)

# ── JSON parsing ───────────────────────────────────────────────────────────────

SAMPLE_JSON = json.dumps({
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
            "diagramRefs": ["page-1-figure-1"],
        }
    ]
})

class TestParseQuizJson:
    def test_valid(self):
        qs = _parse_quiz_json(SAMPLE_JSON, {"page-1-figure-1"})
        assert len(qs) == 1
        assert qs[0].correct_answer_id == "B"
        assert qs[0].diagram_ids == ["page-1-figure-1"]

    def test_strips_markdown_fence(self):
        wrapped = f"```json\n{SAMPLE_JSON}\n```"
        qs = _parse_quiz_json(wrapped, set())
        assert len(qs) == 1
        # diagramRef not in valid set → dropped
        assert qs[0].diagram_ids == []

    def test_invalid_diagram_refs_dropped(self):
        qs = _parse_quiz_json(SAMPLE_JSON, set())
        assert qs[0].diagram_ids == []

    def test_missing_questions_key(self):
        with pytest.raises(QuizGenError):
            _parse_quiz_json('{"bad": true}', set())

    def test_malformed_question_skipped(self):
        bad = json.dumps({"questions": [{"bad": True}]})
        qs = _parse_quiz_json(bad, set())
        assert qs == []

# ── Batched generation ─────────────────────────────────────────────────────────

class TestGenerateQuiz:
    @pytest.mark.asyncio
    async def test_single_batch(self):
        mock_client = AsyncMock()
        mock_client.generate = AsyncMock(return_value=LLMResponse(text=SAMPLE_JSON))

        quiz = await generate_quiz(
            text="Some text",
            diagrams={},
            num_questions=1,
            api_keys=["k1"],
            llm_client=mock_client,
        )
        assert len(quiz.questions) == 1
        assert quiz.id  # non-empty

    @pytest.mark.asyncio
    async def test_diagram_filtering(self):
        import base64
        valid_b64 = base64.b64encode(b"fakejpegdata").decode()
        diagrams = {
            "page-1-figure-1": {"id": "page-1-figure-1", "page": 1, "image_data": valid_b64},
            "page-2-figure-1": {"id": "page-2-figure-1", "page": 2, "image_data": valid_b64},
        }
        mock_client = AsyncMock()
        mock_client.generate = AsyncMock(return_value=LLMResponse(text=SAMPLE_JSON))

        quiz = await generate_quiz(
            text="text",
            diagrams=diagrams,
            num_questions=1,
            api_keys=["k1"],
            llm_client=mock_client,
        )
        # Only page-1-figure-1 is referenced
        assert "page-1-figure-1" in quiz.diagrams
        assert "page-2-figure-1" not in quiz.diagrams

    @pytest.mark.asyncio
    async def test_diagram_cap_per_batch(self, monkeypatch):
        # When the PDF has more diagrams than the per-batch cap, the LLM call
        # should only receive the cap worth, keeping input tokens under budget.
        monkeypatch.setattr(settings, "MAX_DIAGRAMS_PER_BATCH", 2)

        import base64
        valid_b64 = base64.b64encode(b"fakejpegdata").decode()
        diagrams = {
            f"page-{i}-figure-1": {"id": f"page-{i}-figure-1", "page": i, "image_data": valid_b64}
            for i in range(1, 6)  # 5 diagrams, cap is 2
        }
        mock_client = AsyncMock()
        mock_client.generate = AsyncMock(return_value=LLMResponse(text=SAMPLE_JSON))

        await generate_quiz(
            text="text",
            diagrams=diagrams,
            num_questions=1,
            api_keys=["k1"],
            llm_client=mock_client,
        )
        # The single LLM call should have received: 1 text part + 2 image parts.
        prompt_parts = mock_client.generate.call_args.kwargs["prompt_parts"]
        assert len(prompt_parts) == 1 + 2, f"expected 1 text + 2 image parts, got {len(prompt_parts)}"

    @pytest.mark.asyncio
    async def test_text_truncation_per_batch(self, monkeypatch):
        # Very long PDF text → truncated to MAX_TEXT_CHARS_PER_BATCH.
        monkeypatch.setattr(settings, "MAX_TEXT_CHARS_PER_BATCH", 100)

        mock_client = AsyncMock()
        mock_client.generate = AsyncMock(return_value=LLMResponse(text=SAMPLE_JSON))

        long_text = "x" * 500
        await generate_quiz(
            text=long_text,
            diagrams={},
            num_questions=1,
            api_keys=["k1"],
            llm_client=mock_client,
        )
        prompt_text = mock_client.generate.call_args.kwargs["prompt_parts"][0]
        assert "x" * 100 in prompt_text
        assert "truncated to 100 characters" in prompt_text

    @pytest.mark.asyncio
    async def test_inter_batch_pacing(self, monkeypatch):
        # 5 questions / batch_size 2 = 3 batches → 2 inter-batch sleeps of 0.5s.
        monkeypatch.setattr(settings, "LLM_INTER_BATCH_DELAY_SECONDS", 0.5)
        monkeypatch.setattr(settings, "QUIZ_BATCH_SIZE", 2)

        mock_client = AsyncMock()
        mock_client.generate = AsyncMock(return_value=LLMResponse(text=SAMPLE_JSON))

        t0 = time.monotonic()
        await generate_quiz(
            text="text",
            diagrams={},
            num_questions=5,
            api_keys=["k1"],
            llm_client=mock_client,
        )
        elapsed = time.monotonic() - t0
        # 2 × 0.5s sleeps between batches → at least ~1.0s total.
        assert elapsed >= 0.9, f"expected ≥0.9s pacing, got {elapsed:.2f}s"
        assert mock_client.generate.call_count == 3


class TestPartialJsonRecovery:
    """When the LLM hits max_tokens mid-generation, we should still salvage
    whatever complete question objects were already emitted."""

    def test_truncated_response_recovers_complete_questions(self):
        from app.services.quiz_generator import _parse_quiz_json
        # 2 complete questions, then a dangling incomplete object (simulating
        # the LLM hitting max_tokens mid-generation).
        truncated = json.dumps({
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
                    "topic": "Math",
                },
                {
                    "prompt": "Capital of Japan?",
                    "options": [
                        {"id": "A", "text": "Seoul"},
                        {"id": "B", "text": "Tokyo"},
                        {"id": "C", "text": "Beijing"},
                        {"id": "D", "text": "Bangkok"},
                    ],
                    "correctAnswerId": "B",
                    "topic": "Geography",
                },
            ]
        })
        # Chop off the closing brackets to simulate truncation, then append
        # a dangling partial object that the LLM didn't finish.
        truncated = truncated[: -len("\n    ]\n}")]
        truncated += '\n  {"prompt": "What is H2O?", "options": [{"id":"A","text":"water"'
        # Sanity: it's not valid JSON now.
        with pytest.raises(json.JSONDecodeError):
            json.loads(truncated)

        qs = _parse_quiz_json(truncated, set())
        # The 2nd question is cut mid-string ("topic": "Geogr); the recovery
        # code can only salvage the first complete question. The dangling
        # 3rd object is also incomplete and gets skipped.
        assert len(qs) == 1
        assert qs[0].prompt == "What is 2+2?"
        assert qs[0].correct_answer_id == "B"
