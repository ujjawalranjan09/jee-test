"""Tests for quiz export endpoint (Feature 5)."""

from __future__ import annotations

import csv
import io
import json

from fastapi.testclient import TestClient

from app.models.schemas import (
    Diagram,
    Question,
    QuestionOption,
    Quiz,
    QuizExportRequest,
    QuizExportResponse,
)


def _sample_quiz() -> dict:
    """Return a sample quiz as a dict for request body."""
    return {
        "id": "test-quiz-1",
        "questions": [
            {
                "id": "q-1",
                "prompt": "What is 2+2?",
                "options": [
                    {"id": "A", "text": "3"},
                    {"id": "B", "text": "4"},
                    {"id": "C", "text": "5"},
                    {"id": "D", "text": "6"},
                ],
                "correct_answer_id": "B",
                "diagram_ids": [],
                "topic": "Arithmetic",
            },
            {
                "id": "q-2",
                "prompt": "What is the speed of light?",
                "options": [
                    {"id": "A", "text": "3e8 m/s"},
                    {"id": "B", "text": "3e6 m/s"},
                    {"id": "C", "text": "3e10 m/s"},
                    {"id": "D", "text": "3e4 m/s"},
                ],
                "correct_answer_id": "A",
                "diagram_ids": [],
                "topic": "Physics",
            },
        ],
        "diagrams": {},
    }


class TestQuizExportJSON:
    def test_export_json(self, client: TestClient):
        resp = client.post(
            "/api/quiz/export",
            json={"quiz": _sample_quiz(), "format": "json"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["format"] == "json"
        assert data["data"] is not None
        # Verify the data is valid JSON
        parsed = json.loads(data["data"])
        assert parsed["id"] == "test-quiz-1"
        assert len(parsed["questions"]) == 2

    def test_export_json_preserves_topic(self, client: TestClient):
        resp = client.post(
            "/api/quiz/export",
            json={"quiz": _sample_quiz(), "format": "json"},
        )
        data = resp.json()
        parsed = json.loads(data["data"])
        assert parsed["questions"][0]["topic"] == "Arithmetic"
        assert parsed["questions"][1]["topic"] == "Physics"


class TestQuizExportCSV:
    def test_export_csv(self, client: TestClient):
        resp = client.post(
            "/api/quiz/export",
            json={"quiz": _sample_quiz(), "format": "csv"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["format"] == "csv"
        assert data["data"] is not None

        # Parse CSV
        reader = csv.reader(io.StringIO(data["data"]))
        rows = list(reader)
        # Header + 2 questions
        assert len(rows) == 3
        # Check header
        assert rows[0] == [
            "question", "option_a", "option_b", "option_c", "option_d",
            "correct_answer", "topic", "difficulty",
        ]
        # Check first question row
        assert rows[1][0] == "What is 2+2?"
        assert rows[1][1] == "3"  # option_a
        assert rows[1][2] == "4"  # option_b
        assert rows[1][5] == "B"  # correct_answer
        assert rows[1][6] == "Arithmetic"  # topic

    def test_export_csv_topic_column(self, client: TestClient):
        resp = client.post(
            "/api/quiz/export",
            json={"quiz": _sample_quiz(), "format": "csv"},
        )
        data = resp.json()
        reader = csv.reader(io.StringIO(data["data"]))
        rows = list(reader)
        assert rows[1][6] == "Arithmetic"
        assert rows[2][6] == "Physics"

    def test_export_csv_no_topic(self, client: TestClient):
        """Questions without topic should have empty string in CSV."""
        quiz = _sample_quiz()
        quiz["questions"][0]["topic"] = None
        resp = client.post(
            "/api/quiz/export",
            json={"quiz": quiz, "format": "csv"},
        )
        data = resp.json()
        reader = csv.reader(io.StringIO(data["data"]))
        rows = list(reader)
        assert rows[1][6] == ""  # empty topic


class TestQuizExportValidation:
    def test_invalid_format(self, client: TestClient):
        resp = client.post(
            "/api/quiz/export",
            json={"quiz": _sample_quiz(), "format": "xml"},
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["error"]["error_type"] == "invalid_format"

    def test_missing_format(self, client: TestClient):
        resp = client.post(
            "/api/quiz/export",
            json={"quiz": _sample_quiz()},
        )
        assert resp.status_code == 422  # validation error

    def test_missing_quiz(self, client: TestClient):
        resp = client.post(
            "/api/quiz/export",
            json={"format": "json"},
        )
        assert resp.status_code == 422  # validation error


class TestQuizExportSchema:
    def test_export_request_schema(self):
        req = QuizExportRequest(
            quiz=Quiz(**_sample_quiz()),
            format="json",
        )
        assert req.format == "json"
        assert req.quiz.id == "test-quiz-1"

    def test_export_response_schema(self):
        resp = QuizExportResponse(data="{}", format="json")
        assert resp.data == "{}"
        assert resp.error is None

    def test_export_response_with_error(self):
        from app.models.schemas import ErrorDetail
        resp = QuizExportResponse(
            error=ErrorDetail(error_type="test", message="test error"),
        )
        assert resp.data is None
        assert resp.error is not None
