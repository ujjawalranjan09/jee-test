"""Unit tests for diagram extraction (Task 5)."""

from __future__ import annotations

from app.services.pdf_processor import process_pdf


class TestDiagramExtraction:
    def test_pdf_with_figure(self, figure_pdf_bytes):
        result = process_pdf(figure_pdf_bytes)
        assert len(result.diagrams) >= 1
        first = list(result.diagrams.values())[0]
        assert first["page"] == 1
        assert "image_data" in first
        assert isinstance(first["image_data"], str)
        assert len(first["image_data"]) > 0

    def test_diagram_ids_stable(self, figure_pdf_bytes):
        result = process_pdf(figure_pdf_bytes)
        for did, d in result.diagrams.items():
            assert did == d["id"]
            assert did.startswith("page-")

    def test_text_only_pdf_no_diagrams(self, text_pdf_bytes):
        result = process_pdf(text_pdf_bytes)
        # Text-only PDF should have no embedded images
        assert len(result.diagrams) == 0
