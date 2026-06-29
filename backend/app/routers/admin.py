"""Admin endpoints — rotate LLM API keys live, switch provider, test a key.

No auth — admin is only available locally (see the docs in
``app/services/env_file.py`` and the README). All endpoints read from /
write to ``backend/.env`` so changes survive a backend restart and are the
same place the user already manages their keys.

After updating ``.env``, we ALSO patch ``os.environ`` so the running process
uses the new keys on the very next LLM call — no restart required.
"""

from __future__ import annotations

import asyncio
import logging
import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.services.env_file import mask_key, read_env, set_env_var


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class AdminKeyView(BaseModel):
    provider: str = Field(..., description="'gemini' or 'minimax'")
    masked_key: str = Field(..., description="Masked preview, e.g. 'AIza...c123'")
    raw_value: str = Field(..., description="Full key — never sent to the browser in masked form")
    source: str = Field(..., description="'env' — always env right now")
    key_count: int = Field(..., description="How many distinct keys in the pool (split on commas)")


class AdminOverview(BaseModel):
    active_provider: str
    gemini: AdminKeyView
    minimax: AdminKeyView


class UpdateKeyRequest(BaseModel):
    provider: str = Field(..., description="'gemini' or 'minimax'")
    value: str = Field(..., description="The new full key value (or comma-separated list for rotation)")


class UpdateKeyResponse(BaseModel):
    ok: bool
    provider: str
    masked_key: str


class SwitchProviderRequest(BaseModel):
    provider: str = Field(..., description="'gemini' or 'minimax'")


class TestKeyRequest(BaseModel):
    provider: str = Field(..., description="'gemini' or 'minimax'")
    value: str = Field(..., description="The full key value to test")


class TestKeyResponse(BaseModel):
    ok: bool
    provider: str
    message: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _gemini_env_var() -> str:
    """The single ``.env`` key we update for Gemini — we use
    ``GEMINI_API_KEYS`` (comma-separated list) so the existing settings
    splitter handles multi-key rotation out of the box. The user can paste
    a single key or ``key1,key2,key3`` — both work without code changes.
    """
    return "GEMINI_API_KEYS"


def _minimax_env_var() -> str:
    """MiniMax uses ``MIMO_API_KEYS`` for the same reason."""
    return "MIMO_API_KEYS"


def _gemini_current_value() -> str:
    """The Gemini key pool as a single string. We collapse the numbered slots
    + the comma-list into one value for display in the admin UI."""
    return ",".join(settings.env_api_keys() if settings.LLM_PROVIDER == "gemini" else settings.GEMINI_NUMBERED_KEYS or settings.GEMINI_API_KEYS)


def _minimax_current_value() -> str:
    return ",".join(settings.MIMO_API_KEYS)


def _rebuild_settings_key_pools() -> None:
    """Rebuild ``settings.GEMINI_*`` and ``settings.MIMO_API_KEYS`` from the
    live ``os.environ`` so the running process picks up key changes on the
    very next LLM call (no restart required).

    We mirror the parse logic in ``config.Settings`` so the two stay in sync.
    """
    from app.services import env_file as _ef  # circular-safe import

    def _list(name: str) -> list[str]:
        raw = os.getenv(name, "")
        out: list[str] = []
        seen: set[str] = set()
        for piece in raw.split(","):
            k = piece.strip()
            if k and k not in seen:
                seen.add(k)
                out.append(k)
        return out

    settings.GEMINI_API_KEYS = _list("GEMINI_API_KEYS")
    settings.GEMINI_NUMBERED_KEYS = [
        (os.getenv(f"GEMINI_API_KEY_{i}") or "").strip()
        for i in range(1, 10)
        if (os.getenv(f"GEMINI_API_KEY_{i}") or "").strip()
    ]

    raw: list[str] = (
        _list("MIMO_API_KEYS")
        + [(os.getenv("MIMO_API_KEY") or "").strip()]
        + [
            (os.getenv(f"MIMO_API_KEY_{i}") or "").strip()
            for i in range(1, 10)
            if (os.getenv(f"MIMO_API_KEY_{i}") or "").strip()
        ]
    )
    seen: set[str] = set()
    out: list[str] = []
    for k in raw:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    settings.MIMO_API_KEYS = out


def _apply_to_environment(provider: str, value: str) -> None:
    """Patch ``os.environ`` AND the in-process settings so the next LLM call
    uses the new keys without a restart."""
    if provider == "gemini":
        os.environ[_gemini_env_var()] = value
        os.environ["LLM_PROVIDER"] = "gemini"
        settings.LLM_PROVIDER = "gemini"
    elif provider in ("minimax", "xiaomi", "mimo"):
        os.environ[_minimax_env_var()] = value
        os.environ["LLM_PROVIDER"] = "minimax"
        settings.LLM_PROVIDER = "minimax"
    else:
        raise ValueError(f"Unknown provider: {provider!r}")

    # Rebuild the parsed key pools so settings.env_api_keys() returns the
    # fresh values.
    _rebuild_settings_key_pools()


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/overview", response_model=AdminOverview)
async def admin_overview() -> AdminOverview:
    """Current provider + masked preview of the active key pool for both backends."""
    gemini_val = _gemini_current_value()
    minimax_val = _minimax_current_value()
    return AdminOverview(
        active_provider=settings.LLM_PROVIDER,
        gemini=AdminKeyView(
            provider="gemini",
            masked_key=mask_key(gemini_val.split(",")[0].strip()) if gemini_val else "",
            raw_value=gemini_val,
            source="env",
            key_count=len([k for k in gemini_val.split(",") if k.strip()]),
        ),
        minimax=AdminKeyView(
            provider="minimax",
            masked_key=mask_key(minimax_val.split(",")[0].strip()) if minimax_val else "",
            raw_value=minimax_val,
            source="env",
            key_count=len([k for k in minimax_val.split(",") if k.strip()]),
        ),
    )


@router.put("/keys", response_model=UpdateKeyResponse)
async def admin_update_keys(req: UpdateKeyRequest) -> UpdateKeyResponse:
    """Replace the key for a provider. Persists to .env AND updates the running
    process so the next quiz call uses the new key — no restart required."""
    if req.provider == "gemini":
        env_var = _gemini_env_var()
    elif req.provider in ("minimax", "xiaomi", "mimo"):
        env_var = _minimax_env_var()
    else:
        return JSONResponse(
            status_code=400,
            content={"detail": f"Unknown provider: {req.provider!r}"},
        )

    value = (req.value or "").strip()
    if not value:
        return JSONResponse(
            status_code=400,
            content={"detail": "Key value cannot be empty."},
        )

    # Persist + hot-reload
    set_env_var(env_var, value)
    _apply_to_environment(req.provider, value)

    logger.info(
        "admin: rotated %s key (env=%s, length=%d)",
        req.provider, env_var, len(value),
    )
    return UpdateKeyResponse(
        ok=True,
        provider=req.provider,
        masked_key=mask_key(value.split(",")[0].strip()),
    )


@router.post("/provider", response_model=UpdateKeyResponse)
async def admin_switch_provider(req: SwitchProviderRequest) -> UpdateKeyResponse:
    """Switch the active LLM provider. Persists LLM_PROVIDER=gemini|minimax."""
    provider = (req.provider or "").lower()
    if provider == "gemini":
        set_env_var("LLM_PROVIDER", "gemini")
        _apply_to_environment("gemini", os.environ.get(_gemini_env_var(), ""))
    elif provider in ("minimax", "xiaomi", "mimo"):
        set_env_var("LLM_PROVIDER", "minimax")
        _apply_to_environment("minimax", os.environ.get(_minimax_env_var(), ""))
    else:
        return JSONResponse(
            status_code=400,
            content={"detail": f"Unknown provider: {req.provider!r}"},
        )

    logger.info("admin: switched provider to %s", settings.LLM_PROVIDER)
    return UpdateKeyResponse(
        ok=True,
        provider=settings.LLM_PROVIDER,
        masked_key="",  # provider-only change — no key rotated
    )


@router.post("/test", response_model=TestKeyResponse)
async def admin_test_key(req: TestKeyRequest) -> TestKeyResponse:
    """Run a tiny ping call to verify a key works. Does NOT persist the key."""
    value = (req.value or "").strip()
    if not value:
        return TestKeyResponse(ok=False, provider=req.provider, message="Key value cannot be empty.")

    try:
        if req.provider == "gemini":
            await _test_gemini(value)
        elif req.provider in ("minimax", "xiaomi", "mimo"):
            await _test_minimax(value)
        else:
            return TestKeyResponse(ok=False, provider=req.provider, message=f"Unknown provider: {req.provider!r}")
        return TestKeyResponse(ok=True, provider=req.provider, message="Key works.")
    except Exception as exc:
        return TestKeyResponse(ok=False, provider=req.provider, message=str(exc)[:300])


async def _test_gemini(key: str) -> None:
    """Make a 1-token Gemini call with the given key. Raises on auth failure."""
    import google.generativeai as genai

    genai.configure(api_key=key)
    model = genai.GenerativeModel("gemini-2.0-flash")
    loop = asyncio.get_running_loop()

    def _call():
        return model.generate_content("ping", generation_config={"max_output_tokens": 1})

    await asyncio.wait_for(loop.run_in_executor(None, _call), timeout=20)


async def _test_minimax(key: str) -> None:
    """Make a 1-token MiniMax call with the given key. Raises on auth failure."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=key,
        base_url=settings.MIMO_BASE_URL,
        timeout=20,
    )
    await asyncio.wait_for(
        client.chat.completions.create(
            model=settings.MIMO_MODEL,
            messages=[{"role": "user", "content": "ping"}],
            max_completion_tokens=1,
            extra_body={"thinking": {"type": "disabled"}},
        ),
        timeout=20,
    )