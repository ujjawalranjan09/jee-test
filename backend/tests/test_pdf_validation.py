"""Unit tests for PDF validation (Task 3)."""

from __future__ import annotations

import pytest

from app.services.pdf_processor import (
    PDFCorruptedError,
    PDFEmptyError,
    PDFEncryptedError,
    PDFNotPDFError,
    PDFTooLargeError,
    validate_pdf,
)


class TestValidatePDF:
    def test_empty_file(self):
        with pytest.raises(PDFEmptyError):
            validate_pdf(b"")

    def test_too_large(self):
        # Create a blob just over 20 MB with PDF magic
        blob = b"%PDF-1.4" + b"\x00" * (20 * 1024 * 1024 + 100)
        with pytest.raises(PDFTooLargeError):
            validate_pdf(blob)

    def test_not_pdf(self):
        with pytest.raises(PDFNotPDFError):
            validate_pdf(b"This is not a PDF file at all")

    def test_corrupted_pdf(self):
        # Starts with PDF magic but is garbage
        with pytest.raises(PDFCorruptedError):
            validate_pdf(b"%PDF-1.4 corrupted garbage data here")

    def test_valid_text_pdf(self, text_pdf_bytes):
        # Should not raise
        validate_pdf(text_pdf_bytes)

    def test_valid_scanned_pdf(self, scanned_pdf_bytes):
        validate_pdf(scanned_pdf_bytes)

    def test_valid_figure_pdf(self, figure_pdf_bytes):
        validate_pdf(figure_pdf_bytes)
