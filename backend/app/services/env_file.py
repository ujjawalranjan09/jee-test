"""Read/write backend/.env so the admin panel can rotate API keys live.

The file format is plain ``KEY=value`` lines (one per variable). Comments and
blank lines are preserved verbatim. We keep the original line for the variable
we update; everything else is preserved as-is so unrelated settings don't get
touched.

Atomicity: writes go through ``temp file + os.replace`` so a crash mid-write
can't leave a half-written ``.env``.
"""

from __future__ import annotations

import os
import re
from pathlib import Path


_ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"


def _ensure_env_exists() -> None:
    """Create ``.env`` from scratch if it doesn't exist yet."""
    if not _ENV_PATH.exists():
        _ENV_PATH.touch()


def read_env() -> dict[str, str]:
    """Return every ``KEY=value`` pair in ``.env``. Last-write-wins on dupes.

    Values are stripped of surrounding whitespace. Inline comments (``# ...``)
    and quoted values are handled — quoted values keep their interior whitespace.
    """
    _ensure_env_exists()
    out: dict[str, str] = {}
    try:
        text = _ENV_PATH.read_text(encoding="utf-8")
    except OSError:
        return out
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # Strip optional surrounding quotes.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        out[key] = value
    return out


def set_env_var(key: str, value: str) -> None:
    """Insert or update a single ``KEY=value`` line in ``.env``.

    Behaviour:
    * If the key already exists, the existing line is replaced in place so its
      position in the file (and surrounding comments) are preserved.
    * If the key doesn't exist, it's appended at the end of the file with a
      trailing newline.
    * Atomic: written via a sibling temp file + ``os.replace`` so a crash
      mid-write can't corrupt the file.
    """
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        raise ValueError(f"Invalid env var name: {key!r}")

    _ensure_env_exists()
    try:
        original = _ENV_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        original = ""

    new_line = f"{key}={value}\n"
    lines = original.splitlines(keepends=True)
    replaced = False
    for i, raw in enumerate(lines):
        # Match "KEY=..." at the start of the line, ignoring leading whitespace.
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=", raw)
        if m and m.group(1) == key:
            # Preserve any trailing newline on the original line.
            trailing = "\n" if raw.endswith("\n") else ""
            lines[i] = new_line if trailing else new_line.rstrip("\n")
            replaced = True
            break

    if not replaced:
        # New key — append. Ensure file ends with a newline first.
        if lines and not lines[-1].endswith("\n"):
            lines[-1] = lines[-1] + "\n"
        lines.append(new_line)

    new_text = "".join(lines)
    _atomic_write(new_text)


def _atomic_write(text: str) -> None:
    """Write to a temp file in the same dir, then ``os.replace`` onto .env."""
    tmp = _ENV_PATH.with_suffix(".env.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, _ENV_PATH)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def mask_key(key: str) -> str:
    """Mask an API key for display: show first 4 + last 4 chars, dots between.

    ``"AIzaSy...longstring...abc123"`` → ``"AIza...c123"``.
    """
    if not key:
        return ""
    if len(key) <= 12:
        return "*" * len(key)
    return f"{key[:4]}...{key[-4:]}"