"""Integration tests for POST /upload (Task 6)."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient


class TestUploadEndpoint:
    def test_upload_text_pdf(self, client: TestClient, text_pdf_bytes):
        resp = client.post(
            "/api/upload",
            files={"file": ("quiz.pdf", text_pdf_bytes, "application/pdf")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "text" in data
        assert "diagrams" in data
        assert "capital of France" in data["text"]

    def test_upload_figure_pdf(self, client: TestClient, figure_pdf_bytes):
        resp = client.post(
            "/api/upload",
            files={"file": ("fig.pdf", figure_pdf_bytes, "application/pdf")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["diagrams"]) >= 1

    def test_reject_empty_file(self, client: TestClient):
        resp = client.post(
            "/api/upload",
            files={"file": ("empty.pdf", b"", "application/pdf")},
        )
        assert resp.status_code == 400
        assert resp.json()["error_type"] == "empty_file"

    def test_reject_non_pdf(self, client: TestClient):
        resp = client.post(
            "/api/upload",
            files={"file": ("not.txt", b"hello world", "text/plain")},
        )
        assert resp.status_code == 400
        assert resp.json()["error_type"] == "not_pdf"

    def test_reject_too_large(self, client: TestClient):
        blob = b"%PDF-1.4" + b"\x00" * (20 * 1024 * 1024 + 100)
        resp = client.post(
            "/api/upload",
            files={"file": ("big.pdf", blob, "application/pdf")},
        )
        assert resp.status_code == 413
        assert resp.json()["error_type"] == "too_large"

    def test_reject_corrupted(self, client: TestClient):
        resp = client.post(
            "/api/upload",
            files={"file": ("bad.pdf", b"%PDF-1.4 garbage", "application/pdf")},
        )
        assert resp.status_code == 422
        assert resp.json()["error_type"] == "corrupted"

    def test_upload_scanned_pdf(self, client: TestClient, scanned_pdf_bytes):
        """Scanned PDF should either succeed (with OCR) or return no_questions."""
        resp = client.post(
            "/api/upload",
            files={"file": ("scan.pdf", scanned_pdf_bytes, "application/pdf")},
        )
        assert resp.status_code in (200, 422)
