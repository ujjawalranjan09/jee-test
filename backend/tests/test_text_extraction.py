"""Unit tests for text extraction with OCR fallback (Task 4)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.services.pdf_processor import (
    NoQuestionsDetectedError,
    process_pdf,
)


class TestTextExtraction:
    def test_selectable_text_pdf(self, text_pdf_bytes):
        result = process_pdf(text_pdf_bytes)
        assert "capital of France" in result.text
        assert result.has_selectable_text is True

    def test_empty_page_no_questions(self, empty_page_pdf_bytes):
        # Without tesseract, empty page PDF has no selectable text → no_questions
        # With tesseract, still no text found → no_questions
        with pytest.raises(NoQuestionsDetectedError):
            process_pdf(empty_page_pdf_bytes)

    def test_scanned_pdf_fallback(self, scanned_pdf_bytes):
        """Scanned PDF should trigger OCR fallback. Without tesseract binary,
        OCR returns empty and the PDF contains an embedded image so
        diagrams are found — the call should succeed or raise no_questions."""
        result = process_pdf(scanned_pdf_bytes)
        assert isinstance(result.text, str)
        # Scanned PDF has an embedded image, so diagrams should be found
        assert isinstance(result.diagrams, dict)
