"""Tests for POST /quiz/extract (verbatim question extraction from PDF)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from app.services.llm_client import LLMResponse


SAMPLE_EXTRACT_RESPONSE = """```json
{
  "questions": [
    {
      "prompt": "What is the capital of France?",
      "options": [
        {"id": "A", "text": "London"},
        {"id": "B", "text": "Paris"},
        {"id": "C", "text": "Berlin"},
        {"id": "D", "text": "Madrid"}
      ],
      "correctAnswerId": "B",
      "pageNumber": 3,
      "diagramRefs": [],
      "topic": "Geography"
    },
    {
      "prompt": "Solve x^2 + 2x + 1 = 0.",
      "options": [
        {"id": "A", "text": "x = 1"},
        {"id": "B", "text": "x = -1"},
        {"id": "C", "text": "x = 0"},
        {"id": "D", "text": "x = 2"}
      ],
      "correctAnswerId": "",
      "pageNumber": 7,
      "diagramRefs": [],
      "topic": "Algebra"
    }
  ]
}
```"""


class TestExtractEndpoint:
    @patch("app.routers.quiz._llm")
    def test_extract_success(self, mock_llm, client):
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text=SAMPLE_EXTRACT_RESPONSE)
        )
        resp = client.post(
            "/api/quiz/extract",
            json={
                "text": "Page 3: ...Page 7: ...",
                "diagrams": {},
                "num_questions": 5,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["quiz"] is not None
        assert data["error"] is None
        qs = data["quiz"]["questions"]
        assert len(qs) == 2
        # Source mode tagged on every extracted question.
        assert all(q["source_mode"] == "extracted" for q in qs)
        # Page numbers preserved.
        assert qs[0]["page_number"] == 3
        assert qs[1]["page_number"] == 7
        # Correct answer preserved when present, blank when not.
        assert qs[0]["correct_answer_id"] == "B"
        assert qs[1]["correct_answer_id"] == ""

    @patch("app.routers.quiz._llm")
    def test_extract_pads_to_four_options(self, mock_llm, client):
        # Model returns only 2 options; we pad with empty strings so
        # the UI doesn't render inconsistent option counts.
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(
                text='{"questions":[{"prompt":"q","options":[{"id":"A","text":"a"},{"id":"B","text":"b"}],"correctAnswerId":"A","pageNumber":1,"diagramRefs":[],"topic":"T"}]}'
            )
        )
        resp = client.post(
            "/api/quiz/extract",
            json={"text": "x", "diagrams": {}, "num_questions": 1},
        )
        data = resp.json()
        q = data["quiz"]["questions"][0]
        assert len(q["options"]) == 4
        assert q["options"][2]["text"] == ""
        assert q["options"][3]["text"] == ""

    @patch("app.routers.quiz._llm")
    def test_extract_invalid_json_returns_error(self, mock_llm, client):
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text="not json at all")
        )
        resp = client.post(
            "/api/quiz/extract",
            json={"text": "x", "diagrams": {}, "num_questions": 5},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["quiz"] is None
        assert data["error"] is not None
        assert data["error"]["error_type"] == "quiz_validation"

    @patch("app.routers.quiz._llm")
    def test_extract_returns_empty_quiz_when_no_questions(self, mock_llm, client):
        # Source has no MCQs; model returns empty array. We don't
        # invent questions to fill the quota.
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text='{"questions":[]}')
        )
        resp = client.post(
            "/api/quiz/extract",
            json={"text": "x", "diagrams": {}, "num_questions": 5},
        )
        data = resp.json()
        assert data["quiz"] is not None
        assert data["quiz"]["questions"] == []

    @patch("app.routers.quiz._llm")
    def test_extract_invalid_correct_answer_letter_becomes_blank(
        self, mock_llm, client
    ):
        # Some edge-case: model returns "E" or "BLAH" as the correct
        # letter. We coerce to blank rather than crashing the UI.
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(
                text='{"questions":[{"prompt":"q","options":[{"id":"A","text":"a"},{"id":"B","text":"b"},{"id":"C","text":"c"},{"id":"D","text":"d"}],"correctAnswerId":"E","pageNumber":1,"diagramRefs":[],"topic":"T"}]}'
            )
        )
        resp = client.post(
            "/api/quiz/extract",
            json={"text": "x", "diagrams": {}, "num_questions": 1},
        )
        data = resp.json()
        assert data["quiz"]["questions"][0]["correct_answer_id"] == ""

    @patch("app.routers.quiz._llm")
    def test_extract_missing_topic_becomes_none(self, mock_llm, client):
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(
                text='{"questions":[{"prompt":"q","options":[{"id":"A","text":"a"},{"id":"B","text":"b"},{"id":"C","text":"c"},{"id":"D","text":"d"}],"correctAnswerId":"A","pageNumber":1,"diagramRefs":[]}]}'
            )
        )
        resp = client.post(
            "/api/quiz/extract",
            json={"text": "x", "diagrams": {}, "num_questions": 1},
        )
        data = resp.json()
        assert data["quiz"]["questions"][0]["topic"] is None