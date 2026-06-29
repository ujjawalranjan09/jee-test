"""Integration tests for POST /quiz/solve (Task 9)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from app.services.llm_client import LLMResponse


class TestSolveEndpoint:
    @patch("app.routers.quiz._llm")
    def test_solve_success(self, mock_llm, client):
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text="Step 1: 2+2=4\nAnswer: B")
        )
        resp = client.post(
            "/api/quiz/solve",
            json={
                "question": "What is 2+2?",
                "options": [
                    {"id": "A", "text": "3"},
                    {"id": "B", "text": "4"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["solution"] is not None
        assert "Answer: B" in data["solution"]

    @patch("app.routers.quiz._llm")
    def test_solve_with_diagrams(self, mock_llm, client):
        import base64
        valid_b64 = base64.b64encode(b"fakejpegdata").decode()
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text="Based on the diagram, Answer: A")
        )
        resp = client.post(
            "/api/quiz/solve",
            json={
                "question": "What shape is shown?",
                "options": [{"id": "A", "text": "Square"}, {"id": "B", "text": "Circle"}],
                "diagrams": [{"id": "d1", "page": 1, "image_data": valid_b64}],
            },
        )
        assert resp.status_code == 200

    @patch("app.routers.quiz._llm")
    def test_solve_llm_error(self, mock_llm, client):
        from app.services.llm_client import AllKeysExhaustedError
        mock_llm.generate = AsyncMock(side_effect=AllKeysExhaustedError())
        resp = client.post(
            "/api/quiz/solve",
            json={
                "question": "Q?",
                "options": [{"id": "A", "text": "x"}],
            },
        )
        # See test_chat_endpoint.test_chat_llm_error for rationale.
        assert resp.status_code == 200
        assert resp.json()["error"] is not None
        assert resp.json()["error"]["error_type"] == "all_keys_exhausted"


class TestAnswerCrossCheck:
    """Tests for the answer-mismatch detection that flags hallucinated
    correctAnswerId at quiz-generation time. See parse_solver_answer
    and answers_match in app.services.quiz_generator."""

    @patch("app.routers.quiz._llm")
    def test_solver_matches_original_answer(self, mock_llm, client):
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text="Step 1: ...\nAnswer: B")
        )
        resp = client.post(
            "/api/quiz/solve",
            json={
                "question": "What is 2+2?",
                "options": [
                    {"id": "A", "text": "3"},
                    {"id": "B", "text": "4"},
                ],
                "correct_answer_id": "B",
            },
        )
        data = resp.json()
        assert data["parsed_answer"] == "B"
        assert data["original_answer"] == "B"
        assert data["answers_match"] is True

    @patch("app.routers.quiz._llm")
    def test_solver_disagrees_with_original_answer(self, mock_llm, client):
        # This is the bug from the screenshot — quiz said C, solver
        # computed D. The endpoint should report the mismatch so the
        # UI can flag it instead of silently misleading the student.
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(
                text="Working through it...\n10(x-3y) = 75\nAnswer: D"
            )
        )
        resp = client.post(
            "/api/quiz/solve",
            json={
                "question": "Find 10(x-3y).",
                "options": [
                    {"id": "A", "text": "20"},
                    {"id": "B", "text": "31"},
                    {"id": "C", "text": "35"},
                    {"id": "D", "text": "75"},
                ],
                "correct_answer_id": "C",
            },
        )
        data = resp.json()
        assert data["parsed_answer"] == "D"
        assert data["original_answer"] == "C"
        assert data["answers_match"] is False

    @patch("app.routers.quiz._llm")
    def test_missing_correct_answer_id_is_optional(self, mock_llm, client):
        # Old clients that don't send correct_answer_id should still
        # work. answers_match should be None in that case (we don't
        # have enough info to compare).
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text="Some work\nAnswer: A")
        )
        resp = client.post(
            "/api/quiz/solve",
            json={
                "question": "Q?",
                "options": [{"id": "A", "text": "x"}],
            },
        )
        data = resp.json()
        assert data["parsed_answer"] == "A"
        assert data["original_answer"] is None
        assert data["answers_match"] is None

    @patch("app.routers.quiz._llm")
    def test_solver_without_answer_line_returns_none(self, mock_llm, client):
        # If the model forgets to end with "Answer: X" the parsed
        # answer is None. We surface that instead of guessing.
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text="The answer is three.")
        )
        resp = client.post(
            "/api/quiz/solve",
            json={
                "question": "Q?",
                "options": [{"id": "A", "text": "3"}],
                "correct_answer_id": "A",
            },
        )
        data = resp.json()
        assert data["parsed_answer"] is None
        # answers_match is None because one side is missing — we can't
        # say "they disagree" without a parsed value.
        assert data["answers_match"] is None

    @patch("app.routers.quiz._llm")
    def test_solver_handles_bold_and_punctuation(self, mock_llm, client):
        # Common LLM decorations: **Answer: B**, "Answer: B.", etc.
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text="Working it out...\n**Answer: B**.")
        )
        resp = client.post(
            "/api/quiz/solve",
            json={
                "question": "Q?",
                "options": [{"id": "B", "text": "x"}],
                "correct_answer_id": "B",
            },
        )
        data = resp.json()
        assert data["parsed_answer"] == "B"
        assert data["answers_match"] is True

    @patch("app.routers.quiz._llm")
    def test_solver_handles_answer_equals_sign(self, mock_llm, client):
        # Some models write "Answer = C" instead of "Answer: C".
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text="Step 1.\nAnswer = D")
        )
        resp = client.post(
            "/api/quiz/solve",
            json={
                "question": "Q?",
                "options": [{"id": "D", "text": "x"}],
                "correct_answer_id": "D",
            },
        )
        data = resp.json()
        assert data["parsed_answer"] == "D"
        assert data["answers_match"] is True