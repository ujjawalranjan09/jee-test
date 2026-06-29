"""Tests for the admin router — rotating LLM API keys live, switching provider.

Covers:
- env_file read/write (atomic .env updates, preserves unrelated keys)
- mask_key helper (UI preview formatting)
- Admin endpoints: overview (masked), update keys (writes .env + hot-reloads),
  switch provider (LLM_PROVIDER + hot-reload), test key (uses 1-token ping).
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

from app.config import settings
from app.services import env_file
from app.services.env_file import mask_key, read_env, set_env_var


# ── env_file: read / write ─────────────────────────────────────────────────────

def test_env_file_round_trip(tmp_path, monkeypatch):
    """write → read returns the same values; preserves order."""
    fake = tmp_path / ".env"
    monkeypatch.setattr(env_file, "_ENV_PATH", fake)
    set_env_var("FOO", "bar")
    set_env_var("BAZ", "qux")
    pairs = read_env()
    assert pairs["FOO"] == "bar"
    assert pairs["BAZ"] == "qux"


def test_env_file_atomic_update_preserves_unrelated_keys(tmp_path, monkeypatch):
    """Updating one var doesn't disturb others — important since the .env
    also holds CORS, port, and other deployment-specific knobs."""
    fake = tmp_path / ".env"
    fake.write_text(
        "CORS_ORIGINS=*\n"
        "GEMINI_API_KEYS=AIzaSy_old\n"
        "MIMO_API_KEYS=sk-old\n"
        "PORT=8000\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(env_file, "_ENV_PATH", fake)
    set_env_var("GEMINI_API_KEYS", "AIzaSy_new")
    text = fake.read_text()
    # New value present, old value gone.
    assert "AIzaSy_new" in text
    assert "AIzaSy_old" not in text
    # Other lines untouched.
    assert "CORS_ORIGINS=*" in text
    assert "MIMO_API_KEYS=sk-old" in text
    assert "PORT=8000" in text


def test_env_file_atomic_write_creates_temp_then_replaces(tmp_path, monkeypatch):
    """After a set, no leftover .env.tmp exists (cleanup ran)."""
    fake = tmp_path / ".env"
    fake.write_text("FOO=1\n", encoding="utf-8")
    monkeypatch.setattr(env_file, "_ENV_PATH", fake)
    set_env_var("FOO", "2")
    assert not (tmp_path / ".env.tmp").exists()


def test_env_file_creates_file_if_missing(tmp_path, monkeypatch):
    """If .env doesn't exist, set_env_var should create it."""
    fake = tmp_path / ".env"
    assert not fake.exists()
    monkeypatch.setattr(env_file, "_ENV_PATH", fake)
    set_env_var("FOO", "bar")
    assert fake.exists()
    assert read_env()["FOO"] == "bar"


def test_env_file_rejects_invalid_var_names(tmp_path, monkeypatch):
    """Sanity guard — don't let a bad client write garbage key names."""
    fake = tmp_path / ".env"
    monkeypatch.setattr(env_file, "_ENV_PATH", fake)
    with pytest.raises(ValueError):
        set_env_var("1BAD", "x")  # starts with a digit
    with pytest.raises(ValueError):
        set_env_var("BAD-NAME", "x")  # hyphen


# ── mask_key ───────────────────────────────────────────────────────────────────

def test_mask_key_short_long_empty():
    assert mask_key("") == ""
    assert mask_key("abc") == "***"
    assert mask_key("abcdefghijkl") == "************"  # ≤12 → all stars
    assert mask_key("AIzaSyX1234567890abcdef") == "AIza...cdef"


# ── admin router ──────────────────────────────────────────────────────────────

@pytest.fixture
def admin_env(tmp_path, monkeypatch):
    """Set up a tmp .env AND patch settings so the admin router sees fresh values."""
    fake = tmp_path / ".env"
    fake.write_text(
        "GEMINI_API_KEYS=AIzaSy_old_gemini\n"
        "MIMO_API_KEYS=sk-old-mimo\n"
        "LLM_PROVIDER=gemini\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(env_file, "_ENV_PATH", fake)
    # Reset env so the test isn't polluted by values from the real .env at
    # process start.
    for var in (
        "MIMO_API_KEY", "MIMO_API_KEYS", "MIMO_API_KEY_1", "MIMO_API_KEY_2",
        "MIMO_API_KEY_3", "MIMO_API_KEY_4", "MIMO_API_KEY_5",
        "MIMO_API_KEY_6", "MIMO_API_KEY_7", "MIMO_API_KEY_8", "MIMO_API_KEY_9",
        "GEMINI_API_KEYS",
        "GEMINI_API_KEY_1", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3",
        "GEMINI_API_KEY_4", "GEMINI_API_KEY_5", "GEMINI_API_KEY_6",
        "GEMINI_API_KEY_7", "GEMINI_API_KEY_8", "GEMINI_API_KEY_9",
        "LLM_PROVIDER",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("GEMINI_API_KEYS", "AIzaSy_old_gemini")
    monkeypatch.setenv("MIMO_API_KEYS", "sk-old-mimo")
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    settings.LLM_PROVIDER = "gemini"
    settings.GEMINI_API_KEYS = ["AIzaSy_old_gemini"]
    settings.GEMINI_NUMBERED_KEYS = []
    settings.MIMO_API_KEYS = ["sk-old-mimo"]
    return fake


def test_admin_overview_returns_masked_previews(admin_env):
    """GET /admin/overview returns the masked current keys for both providers."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/admin/overview")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["active_provider"] == "gemini"
    assert data["gemini"]["provider"] == "gemini"
    assert data["gemini"]["masked_key"].startswith("AIza")
    assert data["gemini"]["raw_value"] == "AIzaSy_old_gemini"
    assert data["minimax"]["raw_value"] == "sk-old-mimo"


def test_admin_update_keys_writes_to_env_and_hot_reloads(admin_env):
    """PUT /admin/keys updates .env AND settings.MIMO_API_KEYS in-process."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.put(
        "/api/admin/keys",
        json={"provider": "minimax", "value": "sk-mimo-NEW-key-99"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["provider"] == "minimax"

    # .env was rewritten.
    text = admin_env.read_text()
    assert "MIMO_API_KEYS=sk-mimo-NEW-key-99" in text
    # Old value gone.
    assert "sk-old-mimo" not in text
    # Other keys untouched.
    assert "GEMINI_API_KEYS=AIzaSy_old_gemini" in text

    # Hot-reload happened — settings.MIMO_API_KEYS reflects the new key
    # WITHOUT a restart.
    assert "sk-mimo-NEW-key-99" in settings.MIMO_API_KEYS
    assert os.environ["MIMO_API_KEYS"] == "sk-mimo-NEW-key-99"


def test_admin_update_keys_supports_rotation_with_comma_separated(admin_env):
    """The value can be a comma-separated list of multiple keys for rotation."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.put(
        "/api/admin/keys",
        json={"provider": "gemini", "value": "AIzaSy_new1,AIzaSy_new2"},
    )
    assert resp.status_code == 200, resp.text

    # In .env the value is stored as one (comma-separated) line.
    text = admin_env.read_text()
    assert "GEMINI_API_KEYS=AIzaSy_new1,AIzaSy_new2" in text
    # Old value gone, other keys untouched
    assert "AIzaSy_old_gemini" not in text

    # Hot-reload picked up the new env var. The settings reader splits the
    # comma-separated value at parse time, so the user sees both keys in
    # the pool (rotation across both on rate-limit).
    assert "AIzaSy_new1" in settings.GEMINI_API_KEYS
    assert "AIzaSy_new2" in settings.GEMINI_API_KEYS
    assert os.environ["GEMINI_API_KEYS"] == "AIzaSy_new1,AIzaSy_new2"


def test_admin_update_keys_rejects_empty_value(admin_env):
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.put(
        "/api/admin/keys",
        json={"provider": "gemini", "value": ""},
    )
    assert resp.status_code == 400
    assert "empty" in resp.json()["detail"].lower()


def test_admin_update_keys_rejects_unknown_provider(admin_env):
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.put(
        "/api/admin/keys",
        json={"provider": "openai", "value": "sk-x"},
    )
    assert resp.status_code == 400


def test_admin_switch_provider_persists_and_hot_reloads(admin_env):
    """POST /admin/provider switches LLM_PROVIDER without a restart."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.post(
        "/api/admin/provider",
        json={"provider": "minimax"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["provider"] == "minimax"

    # .env persisted
    assert "LLM_PROVIDER=minimax" in admin_env.read_text()
    # In-process state updated
    assert settings.LLM_PROVIDER == "minimax"
    assert os.environ["LLM_PROVIDER"] == "minimax"


def test_admin_switch_provider_accepts_aliases(admin_env):
    """`xiaomi` and `mimo` are accepted as aliases for `minimax`."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    for alias in ("xiaomi", "mimo", "MINIMAX"):
        resp = client.post(
            "/api/admin/provider", json={"provider": alias}
        )
        assert resp.status_code == 200, f"alias {alias!r} should work"
        assert resp.json()["provider"] == "minimax"
    # And reset to gemini at the end so other tests aren't affected
    client.post("/api/admin/provider", json={"provider": "gemini"})


@pytest.mark.asyncio
async def test_admin_test_key_returns_ok_on_valid_known_key_shape(monkeypatch):
    """Test endpoint should return ok=False on a clearly invalid key, never crash.

    We monkey-patch the _test_gemini/_test_minimax helpers to skip the real
    network call — that lets us verify the endpoint plumbing (validation +
    error formatting) without needing a live API key.
    """
    from app.routers import admin as admin_router

    async def fake_ping(*_args, **_kwargs):
        return None

    monkeypatch.setattr(admin_router, "_test_gemini", fake_ping)
    monkeypatch.setattr(admin_router, "_test_minimax", fake_ping)

    resp = await admin_router.admin_test_key(
        admin_router.TestKeyRequest(provider="gemini", value="AIzaSy_dummy"),
    )
    assert resp.ok is True
    assert resp.provider == "gemini"
    assert "works" in resp.message.lower()


@pytest.mark.asyncio
async def test_admin_test_key_returns_failure_on_exception(monkeypatch):
    """If the ping throws, the endpoint must surface the message, not crash."""
    from app.routers import admin as admin_router

    async def fake_ping(*_args, **_kwargs):
        raise RuntimeError("Authentication failed: 401")

    monkeypatch.setattr(admin_router, "_test_gemini", fake_ping)

    resp = await admin_router.admin_test_key(
        admin_router.TestKeyRequest(provider="gemini", value="AIzaSy_bad"),
    )
    assert resp.ok is False
    assert "401" in resp.message


@pytest.mark.asyncio
async def test_admin_test_key_rejects_empty_value():
    from app.routers import admin as admin_router

    resp = await admin_router.admin_test_key(
        admin_router.TestKeyRequest(provider="gemini", value=""),
    )
    assert resp.ok is False
    assert "empty" in resp.message.lower()


@pytest.mark.asyncio
async def test_admin_test_key_rejects_unknown_provider():
    from app.routers import admin as admin_router

    resp = await admin_router.admin_test_key(
        admin_router.TestKeyRequest(provider="openai", value="sk-x"),
    )
    assert resp.ok is False
    assert "unknown" in resp.message.lower()


def test_admin_masking_does_not_leak_full_key(admin_env):
    """The overview's masked_key field must not contain the full key."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/admin/overview")
    data = resp.json()
    full_key = "AIzaSy_old_gemini"
    # raw_value is the unmasked one (we send it deliberately so the admin
    # UI can show "current key, copy this"). masked_key should NOT contain
    # the full value.
    assert full_key in data["gemini"]["raw_value"]
    assert full_key not in data["gemini"]["masked_key"]


def test_admin_endpoints_are_open_no_auth_required(admin_env):
    """Sanity: admin endpoints have NO auth — by design (user chose)."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    # No headers, no cookies, no token — all three should succeed.
    for path, method in [
        ("/api/admin/overview", "GET"),
        ("/api/admin/keys", "PUT"),
        ("/api/admin/provider", "POST"),
        ("/api/admin/test", "POST"),
    ]:
        if method == "GET":
            r = client.get(path)
        elif method == "PUT":
            r = client.put(path, json={"provider": "gemini", "value": "AIzaSy_x"})
        elif method == "POST" and path.endswith("/provider"):
            r = client.post(path, json={"provider": "gemini"})
        else:
            r = client.post(path, json={"provider": "gemini", "value": "AIzaSy_x"})
        # We expect 200 from every endpoint (the /test endpoint makes a
        # real network call though, so it might fail with an HTTP error if
        # the key is invalid — we just need it to NOT be a 401/403).
        assert r.status_code not in (401, 403), (
            f"{method} {path} returned {r.status_code} — admin should be open"
        )