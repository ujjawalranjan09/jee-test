"""Shared test fixtures."""

from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURES = pathlib.Path(__file__).resolve().parent.parent / "fixtures"


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def text_pdf_bytes() -> bytes:
    return (FIXTURES / "text_quiz.pdf").read_bytes()


@pytest.fixture()
def scanned_pdf_bytes() -> bytes:
    return (FIXTURES / "scanned_quiz.pdf").read_bytes()


@pytest.fixture()
def figure_pdf_bytes() -> bytes:
    return (FIXTURES / "pdf_with_figure.pdf").read_bytes()


@pytest.fixture()
def empty_page_pdf_bytes() -> bytes:
    return (FIXTURES / "empty_page.pdf").read_bytes()
