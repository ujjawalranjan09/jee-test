"""POST /upload/multi – Multi-PDF upload with source tracking."""

from __future__ import annotations

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from app.models.schemas import (
    Diagram,
    ErrorDetail,
    MultiUploadResponse,
    UploadResponse,
)
from app.services import pdf_processor

router = APIRouter(tags=["upload"])


@router.post("/upload/multi", response_model=MultiUploadResponse)
async def upload_multiple_pdfs(files: list[UploadFile] = File(...)):
    """Accept multiple PDF uploads, process each individually, return combined results."""
    if not files:
        return JSONResponse(
            status_code=400,
            content=ErrorDetail(
                error_type="no_files",
                message="No files were uploaded.",
            ).model_dump(),
        )

    file_responses: list[UploadResponse] = []
    combined_text_parts: list[str] = []
    combined_diagrams: dict[str, Diagram] = {}
    errors: list[dict] = []

    for upload_file in files:
        filename = upload_file.filename or "unknown.pdf"
        try:
            data = await upload_file.read()
        except Exception:
            errors.append({
                "file": filename,
                "error_type": "read_error",
                "message": f"Failed to read uploaded file: {filename}",
            })
            continue

        try:
            result = pdf_processor.process_pdf(data)
        except pdf_processor.PDFError as exc:
            errors.append({
                "file": filename,
                "error_type": exc.error_type,
                "message": exc.message,
            })
            continue

        diagrams = {}
        for did, d in result.diagrams.items():
            # Add source_file tracking
            d_with_source = {**d, "source_file": filename}
            # Make diagram IDs unique across files to avoid collisions
            unique_id = f"{filename}:{did}"
            d_with_source["id"] = unique_id
            diagrams[unique_id] = Diagram(**d_with_source)

        combined_text_parts.append(f"=== Source: {filename} ===\n{result.text}")
        combined_diagrams.update(diagrams)

        # Pass the diagrams dict so each page's prompt section can list
        # the figure IDs the LLM should reference in diagramRefs.
        diag_for_prompt = {
            did: {"page": d.page, "image_data": d.image_data}
            for did, d in diagrams.items()
        }
        # Per-page layout data for figure-to-question assignment.
        page_layouts: list[dict] = []
        if result.page_blocks:
            for pb in result.page_blocks:
                page_layouts.append({
                    "page_number": pb.page_number,
                    "question_ys": [
                        {"y0": y0, "y1": y1}
                        for (y0, y1) in pb.question_block_positions
                    ],
                    "figure_ys": [
                        {"y0": y0, "y1": y1}
                        for (x0, y0, x1, y1) in pb.image_positions
                    ],
                })
        file_responses.append(
            UploadResponse(
                text=result.text,
                diagrams=diagrams,
                pages=[
                    pdf_processor.format_pages_for_extract(
                        result.page_blocks, diagrams=diag_for_prompt
                    )
                ] if result.page_blocks else [],
                page_layouts=page_layouts,
            )
        )

    if not file_responses and errors:
        # All files failed
        return JSONResponse(
            status_code=400,
            content={
                "error_type": "all_files_failed",
                "message": "All uploaded files failed processing.",
                "details": errors,
            },
        )

    combined_text = "\n\n".join(combined_text_parts)

    response = MultiUploadResponse(
        files=file_responses,
        combined_text=combined_text,
        combined_diagrams=combined_diagrams,
    )

    return response
