"""Application configuration loaded from environment variables.

Reads from ``backend/.env`` first (if present), then falls back to the real
process environment. Recognises both a single comma-separated
``GEMINI_API_KEYS`` and the numbered ``GEMINI_API_KEY_1`` … ``GEMINI_API_KEY_9``
slots — both are merged into ``settings.env_api_keys`` (de-duplicated, order
preserved). Per-request ``api_keys`` from the request body always win.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Resolve backend/.env relative to this file so it works regardless of CWD.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"

load_dotenv(dotenv_path=_ENV_FILE, override=False)


def _env_list(name: str) -> list[str]:
    """Parse a comma-separated env var into a clean list (strips whitespace,
    drops empties, de-duplicates while preserving order)."""
    raw = os.getenv(name, "")
    if not raw:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for piece in raw.split(","):
        key = piece.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


class Settings:
    """Immutable application settings read once at import time."""

    CORS_ORIGINS: list[str] = os.getenv("CORS_ORIGINS", "*").split(",")
    MAX_PDF_SIZE_BYTES: int = int(os.getenv("MAX_PDF_SIZE_BYTES", str(20 * 1024 * 1024)))  # 20 MB
    PROCESSING_TIMEOUT_SECONDS: int = int(os.getenv("PROCESSING_TIMEOUT_SECONDS", "600"))
    LLM_TIMEOUT_SECONDS: int = int(os.getenv("LLM_TIMEOUT_SECONDS", "300"))
    LLM_MAX_RETRIES: int = int(os.getenv("LLM_MAX_RETRIES", "3"))
    QUIZ_BATCH_SIZE: int = int(os.getenv("QUIZ_BATCH_SIZE", "50"))
    CHAT_HISTORY_LIMIT: int = int(os.getenv("CHAT_HISTORY_LIMIT", "20"))
    CHAT_MESSAGE_MAX_CHARS: int = int(os.getenv("CHAT_MESSAGE_MAX_CHARS", "4000"))
    MAX_DIAGRAM_LONG_EDGE: int = int(os.getenv("MAX_DIAGRAM_LONG_EDGE", "1024"))
    DIAGRAM_JPEG_QUALITY: int = int(os.getenv("DIAGRAM_JPEG_QUALITY", "75"))

    # ── Rate-limit / size knobs ────────────────────────────────────────────────
    # All values below have sensible defaults for *paid* LLM tiers (no RPM/TPM
    # caps). If you switch to a free tier, raise LLM_INTER_BATCH_DELAY_SECONDS
    # and lower MAX_DIAGRAMS_PER_BATCH / MAX_TEXT_CHARS_PER_BATCH.
    #
    # Inter-batch pacing — sleeps this many seconds between LLM calls. 0 = no
    # pacing (use this on paid tiers; paid Gemini/MiMo don't need it).
    LLM_INTER_BATCH_DELAY_SECONDS: float = float(os.getenv("LLM_INTER_BATCH_DELAY_SECONDS", "0"))
    # Base delay when the LLM returns a 429 without a hint. Honour Retry-After
    # from the error if present (parsed in llm_client).
    LLM_RETRY_BASE_DELAY_SECONDS: float = float(os.getenv("LLM_RETRY_BASE_DELAY_SECONDS", "2"))
    # Upper bound on any single retry / pacing delay.
    LLM_MAX_RETRY_DELAY_SECONDS: float = float(os.getenv("LLM_MAX_RETRY_DELAY_SECONDS", "30"))
    # Cap on diagrams attached per LLM call. 0 = send every diagram (not
    # recommended past ~30 — multimodal LLMs get distracted by too many small
    # images and output quality drops). Default 25 strikes a balance.
    MAX_DIAGRAMS_PER_BATCH: int = int(os.getenv("MAX_DIAGRAMS_PER_BATCH", "25"))
    # Cap on input text sent to the model per call (chars). 0 = no cap.
    # Default 800k handles most PDFs while staying well under token limits.
    MAX_TEXT_CHARS_PER_BATCH: int = int(os.getenv("MAX_TEXT_CHARS_PER_BATCH", "800000"))

    # ── Gemini API keys ────────────────────────────────────────────────────────
    # Single comma-separated list:
    GEMINI_API_KEYS: list[str] = _env_list("GEMINI_API_KEYS")
    # Numbered slots GEMINI_API_KEY_1 … GEMINI_API_KEY_9
    # (matches the 9-key screenshot in the ops doc).
    # Each slot holds a single key (no commas), so we read the raw env var.
    GEMINI_NUMBERED_KEYS: list[str] = [
        (os.getenv(f"GEMINI_API_KEY_{i}") or "").strip()
        for i in range(1, 10)
        if (os.getenv(f"GEMINI_API_KEY_{i}") or "").strip()
    ]

    # ── LLM provider selector ─────────────────────────────────────────────────
    # "gemini" (default, legacy) or "minimax" (Xiaomi MiMo v2.5, OpenAI-compatible).
    LLM_PROVIDER: str = (os.getenv("LLM_PROVIDER", "gemini") or "gemini").lower()

    # ── MiniMax (Xiaomi MiMo) config ───────────────────────────────────────────
    _mimo_raw: list[str] = (
        _env_list("MIMO_API_KEYS")
        + [(os.getenv("MIMO_API_KEY") or "").strip()]
        + [
            (os.getenv(f"MIMO_API_KEY_{i}") or "").strip()
            for i in range(1, 10)
            if (os.getenv(f"MIMO_API_KEY_{i}") or "").strip()
        ]
    )
    # De-duplicate preserving order. List-comprehensions create their own
    # scope, so we do this with an explicit loop instead of an inline
    # ``or _mimo_seen.add(k)`` trick.
    _mimo_seen: set[str] = set()
    MIMO_API_KEYS: list[str] = []
    for _k in _mimo_raw:
        if _k and _k not in _mimo_seen:
            _mimo_seen.add(_k)
            MIMO_API_KEYS.append(_k)
    del _mimo_raw, _mimo_seen, _k  # keep class namespace tidy
    MIMO_BASE_URL: str = os.getenv("MIMO_BASE_URL", "https://api.xiaomimimo.com/v1")
    MIMO_MODEL: str = os.getenv("MIMO_MODEL", "mimo-v2.5")

    def env_api_keys(self) -> list[str]:
        """Provider-aware merged, de-duplicated, order-preserving list of
        every API key declared via environment variables.

        If ``LLM_PROVIDER`` is set to ``minimax`` / ``xiaomi`` / ``mimo``
        (any of these are accepted), returns the MiniMax key pool. Otherwise
        returns the Gemini key pool (legacy default).
        """
        if self.LLM_PROVIDER in ("minimax", "xiaomi", "mimo"):
            return list(self.MIMO_API_KEYS)
        merged: list[str] = []
        seen: set[str] = set()
        for k in self.GEMINI_API_KEYS + self.GEMINI_NUMBERED_KEYS:
            if k and k not in seen:
                seen.add(k)
                merged.append(k)
        return merged

    def has_env_keys(self) -> bool:
        return bool(self.env_api_keys())


settings = Settings()