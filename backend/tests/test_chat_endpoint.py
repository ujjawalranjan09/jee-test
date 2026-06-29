"""Integration tests for POST /quiz/chat (Task 10)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from app.services.llm_client import LLMResponse

class TestChatEndpoint:
    @patch("app.routers.quiz._llm")
    def test_chat_success(self, mock_llm, client):
        mock_llm.generate = AsyncMock(
            return_value=LLMResponse(text="The answer is B because 2+2=4.")
        )
        resp = client.post(
            "/api/quiz/chat",
            json={
                "question": "What is 2+2?",
                "options": [
                    {"id": "A", "text": "3"},
                    {"id": "B", "text": "4"},
                ],
                "message": "Why is it B?",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["reply"] is not None

    def test_chat_empty_message(self, client):
        resp = client.post(
            "/api/quiz/chat",
            json={
                "question": "Q?",
                "message": "",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["error_type"] == "empty_message"

    def test_chat_whitespace_message(self, client):
        resp = client.post(
            "/api/quiz/chat",
            json={
                "question": "Q?",
                "message": "   ",
            },
        )
        assert resp.status_code == 400

    def test_chat_too_long_message(self, client):
        resp = client.post(
            "/api/quiz/chat",
            json={
                "question": "Q?",
                "message": "x" * 4001,
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["error_type"] == "message_too_long"

    @patch("app.routers.quiz._llm")
    def test_chat_with_history(self, mock_llm, client):
        mock_llm.generate = AsyncMock(return_value=LLMResponse(text="Follow-up answer"))
        resp = client.post(
            "/api/quiz/chat",
            json={
                "question": "What is 2+2?",
                "options": [{"id": "A", "text": "3"}, {"id": "B", "text": "4"}],
                "prior_messages": [
                    {"role": "user", "content": "What is the answer?"},
                    {"role": "assistant", "content": "The answer is B."},
                ],
                "message": "Can you explain more?",
            },
        )
        assert resp.status_code == 200

    @patch("app.routers.quiz._llm")
    def test_chat_llm_error(self, mock_llm, client):
        from app.services.llm_client import AllKeysExhaustedError
        mock_llm.generate = AsyncMock(side_effect=AllKeysExhaustedError())
        resp = client.post(
            "/api/quiz/chat",
            json={
                "question": "Q?",
                "message": "Help",
            },
        )
        # LLM errors are returned as HTTP 200 with a structured error body,
        # so the frontend can render the actual message instead of a bare
        # "Request failed (502)".
        assert resp.status_code == 200
        assert resp.json()["error"] is not None
        assert resp.json()["error"]["error_type"] == "all_keys_exhausted"

    @patch("app.routers.quiz._llm")
    def test_chat_with_diagrams(self, mock_llm, client):
        import base64
        valid_b64 = base64.b64encode(b"fakejpegdata").decode()
        mock_llm.generate = AsyncMock(return_value=LLMResponse(text="See diagram"))
        resp = client.post(
            "/api/quiz/chat",
            json={
                "question": "Describe the figure.",
                "message": "What does it show?",
                "diagrams": [{"id": "d1", "page": 1, "image_data": valid_b64}],
            },
        )
        assert resp.status_code == 200
