"""Unit tests for the LLM client with mocked transport (Task 7)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from app.services.llm_client import (
    AllKeysExhaustedError,
    LLMClient,
    LLMResponse,
    LLMTimeoutError,
    MinimaxTransport,
    NoKeysError,
    _extract_retry_delay_seconds,
    _prompt_parts_to_messages,
    build_image_parts,
)

# In tests we don't want to actually sleep for backoff — inject a no-op.
async def _no_sleep(_: float) -> None:
    return None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _mock_transport(responses: list):
    """Return a mock transport that yields responses in order, then raises."""
    transport = AsyncMock()
    transport.generate = AsyncMock(side_effect=responses)
    return transport


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestLLMClient:
    @pytest.mark.asyncio
    async def test_no_keys(self):
        client = LLMClient(transport=AsyncMock())
        with pytest.raises(NoKeysError):
            await client.generate(api_keys=[], prompt_parts=["hi"], sleep=_no_sleep)

    @pytest.mark.asyncio
    async def test_first_key_success(self):
        transport = _mock_transport([LLMResponse(text="ok")])
        client = LLMClient(transport=transport)
        resp = await client.generate(
            api_keys=["key1", "key2"], prompt_parts=["hi"], sleep=_no_sleep,
        )
        assert resp.text == "ok"
        assert transport.generate.call_count == 1

    @pytest.mark.asyncio
    async def test_key_fallback_on_failure(self):
        transport = _mock_transport([
            Exception("429 rate limit"),
            LLMResponse(text="fallback ok"),
        ])
        client = LLMClient(transport=transport)
        resp = await client.generate(
            api_keys=["bad_key", "good_key"],
            prompt_parts=["hi"],
            max_retries=1,
            sleep=_no_sleep,
        )
        assert resp.text == "fallback ok"
        assert transport.generate.call_count == 2

    @pytest.mark.asyncio
    async def test_all_keys_exhausted(self):
        transport = _mock_transport([
            Exception("403 forbidden"),
            Exception("403 forbidden"),
        ])
        client = LLMClient(transport=transport)
        with pytest.raises(AllKeysExhaustedError):
            await client.generate(
                api_keys=["k1", "k2"],
                prompt_parts=["hi"],
                max_retries=1,
                sleep=_no_sleep,
            )

    @pytest.mark.asyncio
    async def test_timeout_raises(self):
        transport = AsyncMock()
        transport.generate = AsyncMock(side_effect=asyncio.TimeoutError)
        client = LLMClient(transport=transport)
        with pytest.raises(AllKeysExhaustedError):
            await client.generate(
                api_keys=["k1"],
                prompt_parts=["hi"],
                max_retries=1,
                sleep=_no_sleep,
            )

    @pytest.mark.asyncio
    async def test_retries_per_key(self):
        # Two temporary failures then success. With max_retries=3 the client
        # retries the same key across all three attempts.
        transport = _mock_transport([
            Exception("temporary"),
            Exception("temporary"),
            LLMResponse(text="retry success"),
        ])
        client = LLMClient(transport=transport)
        resp = await client.generate(
            api_keys=["k1"],
            prompt_parts=["hi"],
            max_retries=3,
            sleep=_no_sleep,
        )
        assert resp.text == "retry success"
        assert transport.generate.call_count == 3


class TestRetryDelayParsing:
    """Verify we honour Gemini's structured retry_delay hint."""

    def test_parses_seconds_from_string(self):
        err = Exception("... retry_delay { seconds: 21 } ...")
        assert _extract_retry_delay_seconds(err) == 21.0

    def test_returns_none_when_missing(self):
        err = Exception("plain error")
        assert _extract_retry_delay_seconds(err) is None

    def test_reads_metadata_if_present(self):
        class _MockRetryInfo:
            seconds = 42

        class _Err(Exception):
            pass

        err = _Err("...")
        err.metadata = [("retryDelay", _MockRetryInfo())]
        assert _extract_retry_delay_seconds(err) == 42.0

    def test_parses_please_retry_in(self):
        # The format Gemini actually emits in free-tier quota errors.
        err = Exception(
            "429 You exceeded your current quota... "
            "Please retry in 39.804535511s."
        )
        assert _extract_retry_delay_seconds(err) == 39.804535511

    def test_parses_multiline_retry_delay(self):
        err = Exception(
            "..., retry_delay {\n"
            "  seconds: 59\n"
            "}"
        )
        assert _extract_retry_delay_seconds(err) == 59.0


class TestRateLimitRetries:
    """End-to-end behaviour: 429 with a retry_delay is honoured instead of giving up."""

    @pytest.mark.asyncio
    async def test_honours_retry_delay_then_succeeds(self):
        # First attempt hits 429 with retry_delay=10. We sleep (no-op) then retry
        # the same key and get a real response.
        err = Exception("quota exceeded ... retry_delay { seconds: 10 } ...")
        transport = _mock_transport([err, LLMResponse(text="ok")])
        client = LLMClient(transport=transport)

        sleep_calls: list[float] = []

        async def _track_sleep(s: float) -> None:
            sleep_calls.append(s)

        resp = await client.generate(
            api_keys=["k1"],
            prompt_parts=["hi"],
            max_retries=3,
            sleep=_track_sleep,
        )
        assert resp.text == "ok"
        assert transport.generate.call_count == 2
        assert sleep_calls == [10.0]

    @pytest.mark.asyncio
    async def test_uses_exponential_backoff_when_no_hint(self):
        # No retry_delay hint → exponential backoff from base delay.
        err = Exception("plain quota error")
        transport = _mock_transport([err, err, err, LLMResponse(text="ok")])
        client = LLMClient(transport=transport)

        sleep_calls: list[float] = []

        async def _track_sleep(s: float) -> None:
            sleep_calls.append(s)

        resp = await client.generate(
            api_keys=["k1"],
            prompt_parts=["hi"],
            max_retries=4,
            sleep=_track_sleep,
        )
        assert resp.text == "ok"
        # Backoff from settings.LLM_RETRY_BASE_DELAY_SECONDS (default 2):
        # base * 2^0, base * 2^1, base * 2^2 → 2, 4, 8 (capped at 30).
        assert sleep_calls == [2.0, 4.0, 8.0]

    @pytest.mark.asyncio
    async def test_auth_error_breaks_out_immediately(self):
        # API_KEY_INVALID on key1 → don't retry key1, try key2.
        transport = _mock_transport([
            Exception("400 API_KEY_INVALID"),
            LLMResponse(text="key2 works"),
        ])
        client = LLMClient(transport=transport)
        resp = await client.generate(
            api_keys=["bad", "good"],
            prompt_parts=["hi"],
            max_retries=3,
            sleep=_no_sleep,
        )
        assert resp.text == "key2 works"
        assert transport.generate.call_count == 2


class TestBuildImageParts:
    def test_empty(self):
        assert build_image_parts([]) == []

    def test_with_diagram(self):
        import base64
        img_data = base64.b64encode(b"fakejpeg").decode()
        parts = build_image_parts([{"image_data": img_data}])
        assert len(parts) == 1
        assert parts[0]["inline_data"]["mime_type"] == "image/jpeg"


class TestPromptPartsToMessages:
    def test_text_only(self):
        msgs = _prompt_parts_to_messages(["hello world"])
        assert msgs == [{"role": "user", "content": [{"type": "text", "text": "hello world"}]}]

    def test_text_and_image(self):
        import base64
        b64 = base64.b64encode(b"fakejpeg").decode()
        parts = [
            "describe this image",
            {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
        ]
        msgs = _prompt_parts_to_messages(parts)
        assert len(msgs) == 1
        content = msgs[0]["content"]
        assert len(content) == 2
        assert content[0] == {"type": "text", "text": "describe this image"}
        assert content[1]["type"] == "image_url"
        assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
        assert content[1]["image_url"]["url"].endswith(b64)


class TestOpenAIRetryHints:
    """OpenAI RateLimitError surfaces retry-after differently from Gemini."""

    def test_parses_try_again_in(self):
        err = Exception("Error code: 429 - You exceeded your current quota. Please try again in 30s.")
        assert _extract_retry_delay_seconds(err) == 30.0
