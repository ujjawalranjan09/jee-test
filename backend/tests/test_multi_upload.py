"""Tests for multi-PDF upload endpoint (Feature 4)."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient


class TestMultiUploadEndpoint:
    def test_upload_single_pdf(self, client: TestClient, text_pdf_bytes):
        resp = client.post(
            "/api/upload/multi",
            files=[("files", ("quiz.pdf", text_pdf_bytes, "application/pdf"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "files" in data
        assert "combined_text" in data
        assert "combined_diagrams" in data
        assert len(data["files"]) == 1
        assert "capital of France" in data["combined_text"]

    def test_upload_multiple_pdfs(self, client: TestClient, text_pdf_bytes, figure_pdf_bytes):
        resp = client.post(
            "/api/upload/multi",
            files=[
                ("files", ("quiz.pdf", text_pdf_bytes, "application/pdf")),
                ("files", ("figure.pdf", figure_pdf_bytes, "application/pdf")),
            ],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["files"]) == 2
        assert "combined_text" in data
        # Both files should be represented in combined text
        assert "Source: quiz.pdf" in data["combined_text"]
        assert "Source: figure.pdf" in data["combined_text"]

    def test_diagrams_have_source_file(self, client: TestClient, figure_pdf_bytes):
        resp = client.post(
            "/api/upload/multi",
            files=[("files", ("fig.pdf", figure_pdf_bytes, "application/pdf"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        # Check combined diagrams have source_file field
        for did, diagram in data["combined_diagrams"].items():
            assert "source_file" in diagram
            assert diagram["source_file"] == "fig.pdf"

    def test_reject_no_files(self, client: TestClient):
        resp = client.post("/api/upload/multi")
        # FastAPI returns 422 when required file list is missing
        assert resp.status_code in (400, 422)

    def test_partial_failure(self, client: TestClient, text_pdf_bytes):
        """One valid file and one invalid file should still return the valid one."""
        resp = client.post(
            "/api/upload/multi",
            files=[
                ("files", ("good.pdf", text_pdf_bytes, "application/pdf")),
                ("files", ("bad.pdf", b"not a pdf", "application/pdf")),
            ],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["files"]) == 1
        assert "capital of France" in data["combined_text"]

    def test_all_files_fail(self, client: TestClient):
        resp = client.post(
            "/api/upload/multi",
            files=[
                ("files", ("bad1.pdf", b"not a pdf", "application/pdf")),
                ("files", ("bad2.pdf", b"also not a pdf", "application/pdf")),
            ],
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["error_type"] == "all_files_failed"

    def test_combined_diagrams_from_multiple_files(self, client: TestClient, figure_pdf_bytes):
        """Upload the same figure PDF twice; diagrams should have unique IDs."""
        resp = client.post(
            "/api/upload/multi",
            files=[
                ("files", ("fig1.pdf", figure_pdf_bytes, "application/pdf")),
                ("files", ("fig2.pdf", figure_pdf_bytes, "application/pdf")),
            ],
        )
        assert resp.status_code == 200
        data = resp.json()
        # Diagrams from different files should have different IDs
        diagram_ids = list(data["combined_diagrams"].keys())
        # Since we prefix with filename, same figure from different files gets different IDs
        fig1_ids = [d for d in diagram_ids if d.startswith("fig1.pdf:")]
        fig2_ids = [d for d in diagram_ids if d.startswith("fig2.pdf:")]
        assert len(fig1_ids) > 0
        assert len(fig2_ids) > 0
        assert set(fig1_ids).isdisjoint(set(fig2_ids))
