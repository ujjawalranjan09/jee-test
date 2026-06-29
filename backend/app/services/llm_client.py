"""LLM client with multi-key rotation, timeout, and retry.

Two transports are supported and selected by ``settings.LLM_PROVIDER``:

* ``"gemini"`` (default) — Google's Gemini via ``google.generativeai``.
* ``"minimax"`` — Xiaomi's MiMo v2.5 (and similar) via the OpenAI-compatible
  chat-completion endpoint at ``MIMO_BASE_URL``.

Both share the same ``LLMClient.generate(...)`` interface so the rest of the
codebase (multi-key rotation, retries, rate-limit pacing) is unchanged.
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.config import settings

logger = logging.getLogger(__name__)


# ── Exceptions ─────────────────────────────────────────────────────────────────

class LLMError(Exception):
    error_type: str = "llm_error"


class NoKeysError(LLMError):
    error_type = "no_keys"

    def __init__(self) -> None:
        super().__init__("No API keys were provided.")


class AllKeysExhaustedError(LLMError):
    error_type = "all_keys_exhausted"

    def __init__(self) -> None:
        super().__init__("All provided API keys failed (rate-limited or rejected).")


class LLMTimeoutError(LLMError):
    error_type = "llm_timeout"

    def __init__(self) -> None:
        super().__init__("LLM request timed out.")


class LLMResponseError(LLMError):
    error_type = "llm_response_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)


# ── Transport abstraction ─────────────────────────────────────────────────────

@dataclass
class LLMResponse:
    text: str


def _prompt_parts_to_messages(prompt_parts: list) -> list[dict[str, Any]]:
    """Translate Gemini-style ``prompt_parts`` into OpenAI chat-completion messages.

    The first element is conventionally the text prompt. Any subsequent
    ``{"inline_data": {"mime_type": ..., "data": <b64>}}`` entries become
    image_url content blocks. Unknown shapes fall back to text rendering.
    """
    text_blocks: list[str] = []
    image_blocks: list[dict[str, Any]] = []

    for part in prompt_parts:
        if isinstance(part, str):
            text_blocks.append(part)
            continue
        if not isinstance(part, dict):
            text_blocks.append(str(part))
            continue
        inline = part.get("inline_data")
        if inline:
            mime = inline.get("mime_type", "image/jpeg")
            data = inline.get("data", "")
            if data:
                image_blocks.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{data}"},
                })
                continue
        # Unknown structured part — stringify and treat as text.
        text_blocks.append(str(part))

    content: list[dict[str, Any]] = []
    for t in text_blocks:
        content.append({"type": "text", "text": t})
    content.extend(image_blocks)

    return [{"role": "user", "content": content}]


class GeminiTransport:
    """Thin wrapper around google.generativeai. Extracted so tests can substitute a mock."""

    async def generate(self, *, api_key: str, prompt_parts: list, timeout: float) -> LLMResponse:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

        loop = asyncio.get_running_loop()

        def _call():
            return model.generate_content(prompt_parts)

        resp = await asyncio.wait_for(loop.run_in_executor(None, _call), timeout=timeout)
        return LLMResponse(text=resp.text)


class MinimaxTransport:
    """OpenAI-compatible transport for Xiaomi MiMo v2.5 and similar endpoints.

    Uses the official ``openai`` SDK's async client, pointed at
    ``settings.MIMO_BASE_URL``. Handles multimodal (text + image) prompts by
    translating Gemini-style ``prompt_parts`` into the OpenAI message shape.
    """

    def __init__(self) -> None:
        self._client = None  # lazily built per-key

    def _get_client(self, api_key: str):
        from openai import AsyncOpenAI

        return AsyncOpenAI(
            api_key=api_key,
            base_url=settings.MIMO_BASE_URL,
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )

    async def generate(self, *, api_key: str, prompt_parts: list, timeout: float) -> LLMResponse:
        from openai import (
            APIConnectionError,
            APITimeoutError,
            AuthenticationError,
            BadRequestError,
            RateLimitError,
        )

        client = self._get_client(api_key)
        messages = _prompt_parts_to_messages(prompt_parts)

        # Extra kwargs to disable MiMo's "thinking" mode (faster responses,
        # matches the user's reference snippet).
        extra_body = {"thinking": {"type": "disabled"}}

        try:
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=settings.MIMO_MODEL,
                    messages=messages,
                    max_completion_tokens=32768,
                    stream=False,
                    extra_body=extra_body,
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            raise
        except AuthenticationError as exc:
            # Bubble up so the LLMClient recognises it as an auth failure
            # and moves to the next key.
            raise LLMError(f"Authentication failed: {exc}") from exc
        except RateLimitError as exc:
            # Will be retried after backoff.
            raise
        except (APIConnectionError, APITimeoutError, BadRequestError) as exc:
            raise LLMError(str(exc)) from exc

        # Extract text from the chat-completion response.
        text = _extract_text_from_chat_completion(resp)
        if not text:
            raise LLMResponseError("LLM returned empty response.")
        return LLMResponse(text=text)


def _extract_text_from_chat_completion(resp: Any) -> str:
    """Pull the assistant text out of an OpenAI ChatCompletion object.

    Works whether ``resp`` is a Pydantic model (normal SDK return) or a
    plain dict (when callers pass ``model_dump()``/``to_dict()``).
    """
    choices = getattr(resp, "choices", None)
    if choices is None and isinstance(resp, dict):
        choices = resp.get("choices")
    if not choices:
        return ""
    first = choices[0]
    msg = getattr(first, "message", None)
    if msg is None and isinstance(first, dict):
        msg = first.get("message")
    if msg is None:
        return ""
    content = getattr(msg, "content", None)
    if content is None and isinstance(msg, dict):
        content = msg.get("content")
    if isinstance(content, list):
        # Some endpoints return a list of content blocks; join text parts.
        parts: list[str] = []
        for blk in content:
            if isinstance(blk, dict):
                if blk.get("type") == "text" and blk.get("text"):
                    parts.append(blk["text"])
            else:
                t = getattr(blk, "text", None)
                if t:
                    parts.append(t)
        return "\n".join(parts)
    return content or ""


# ── Public client ──────────────────────────────────────────────────────────────

class LLMClient:
    """High-level client: multi-key rotation, retries, timeout, rate-limit pacing.

    Pick a transport based on ``settings.LLM_PROVIDER``. Tests can override
    by passing ``transport=`` directly.
    """

    def __init__(self, transport: Any | None = None) -> None:
        if transport is not None:
            self.transport = transport
        elif settings.LLM_PROVIDER in ("minimax", "xiaomi", "mimo"):
            self.transport = MinimaxTransport()
        else:
            self.transport = GeminiTransport()

    async def generate(
        self,
        *,
        api_keys: list[str],
        prompt_parts: list,
        timeout: float | None = None,
        max_retries: int | None = None,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> LLMResponse:
        """Try keys in order, with retries per key.

        On a 429 / rate-limit we wait the suggested ``retry_delay`` (or
        exponential backoff) and try the next key. We only break out of
        per-key retries early when the error is an *auth* failure
        (``API_KEY_INVALID``, ``401 unauthorized``, ``403 permission``) —
        rotating keys won't help if the key itself is invalid.

        ``sleep`` is an injectable sleep function (default ``asyncio.sleep``)
        so tests can run instantly by passing ``lambda _: asyncio.sleep(0)``.
        """
        if not api_keys:
            raise NoKeysError()

        if sleep is None:
            sleep = asyncio.sleep

        timeout = timeout or settings.LLM_TIMEOUT_SECONDS
        max_retries = max_retries or settings.LLM_MAX_RETRIES

        last_exc: Exception | None = None
        project_quota_delay: float = 0.0

        for key in api_keys:
            for attempt in range(1, max_retries + 1):
                try:
                    resp = await self.transport.generate(
                        api_key=key, prompt_parts=prompt_parts, timeout=timeout,
                    )
                    return resp
                except asyncio.TimeoutError:
                    last_exc = LLMTimeoutError()
                    logger.warning("Key ...%s attempt %d timed out", key[-6:], attempt)
                except Exception as exc:
                    last_exc = exc
                    _msg = str(exc).lower()
                    logger.warning(
                        "Key ...%s attempt %d failed: %s", key[-6:], attempt, exc,
                    )

                    # Auth error — this specific key is bad. Stop trying it.
                    if any(kw in _msg for kw in (
                        "api_key_invalid", "permission", "403",
                        "unauthorized", "401", "incorrect api key",
                        "authentication", "invalid api key",
                    )):
                        break

                    # Rate-limit / quota error — wait, then either retry or
                    # move to next key.
                    delay = _extract_retry_delay_seconds(exc)
                    if delay is None:
                        delay = min(
                            settings.LLM_RETRY_BASE_DELAY_SECONDS * (2 ** (attempt - 1)),
                            settings.LLM_MAX_RETRY_DELAY_SECONDS,
                        )
                    project_quota_delay = max(project_quota_delay, delay)
                    logger.warning(
                        "Rate limited — sleeping %.1fs before next attempt (hint=%s)",
                        delay,
                        _extract_retry_delay_seconds(exc),
                    )
                    await sleep(delay)

                    if attempt >= max_retries:
                        break

        raise AllKeysExhaustedError() from last_exc


def _extract_retry_delay_seconds(exc: Exception) -> float | None:
    """Try to read a retry-delay hint out of an LLM quota error.

    Supports both Gemini-style and OpenAI-style error formats:

    * OpenAI RateLimitError: ``exc.response.headers["retry-after"]`` (seconds
      or HTTP-date) or ``exc.message`` mentions "Try again in Xs".
    * Gemini: ``google.api_core`` metadata, plain English
      ``"Please retry in 39.8s."``, multi-line protobuf ``retry_delay {...}``.
    """
    # 1) OpenAI-style: Retry-After header on RateLimitError.
    response = getattr(exc, "response", None)
    if response is not None:
        headers = getattr(response, "headers", None) or {}
        retry_after = headers.get("retry-after") or headers.get("Retry-After")
        if retry_after:
            try:
                return float(retry_after)
            except ValueError:
                # HTTP-date format — be conservative and use the cap.
                return float(settings.LLM_MAX_RETRY_DELAY_SECONDS)

    text = str(exc)

    # 2) OpenAI-style plain English: "Please try again in Xs" / "Try again in Xs".
    m = re.search(r"(?:please\s+)?try again in\s+([0-9]+(?:\.[0-9]+)?)\s*s\b", text, re.I)
    if m:
        return float(m.group(1))

    # 3) Gemini plain English: "Please retry in Xs."
    m = re.search(r"Please retry in\s+([0-9]+(?:\.[0-9]+)?)\s*s\b", text)
    if m:
        return float(m.group(1))

    # 4) Gemini google.api_core metadata.
    metadata = getattr(exc, "metadata", None)
    if metadata is not None:
        try:
            for entry in metadata:
                key = entry[0] if isinstance(entry, tuple) else None
                value = entry[1] if isinstance(entry, tuple) else None
                if key and "retry" in str(key).lower() and value is not None:
                    secs = getattr(value, "seconds", None)
                    if secs is not None:
                        return float(secs)
        except Exception:
            pass

    # 5) Gemini multi-line protobuf dump.
    m = re.search(r"retry_delay\s*\{[^}]*?seconds:\s*([0-9]+(?:\.[0-9]+)?)", text, re.DOTALL)
    if m:
        return float(m.group(1))

    return None


# ── Helpers to build prompt parts ──────────────────────────────────────────────

def build_image_parts(diagrams: list[dict]) -> list[dict]:
    """Convert a list of diagram dicts (with base64 image_data) to image parts.

    Returns Gemini-style ``{"inline_data": {...}}`` dicts; the transport layer
    translates these into OpenAI ``image_url`` blocks when needed.
    """
    parts: list[dict] = []
    for d in diagrams:
        try:
            raw = d["image_data"]
            base64.b64decode(raw)  # validate
            parts.append({
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": raw,
                }
            })
        except Exception:
            logger.warning("Skipping diagram %s with invalid image_data", d.get("id", "?"))
    return parts