"""POST /upload – PDF upload, validation, text + diagram extraction."""

from __future__ import annotations

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from app.models.schemas import Diagram, ErrorDetail, UploadResponse
from app.services import pdf_processor

router = APIRouter(tags=["upload"])


@router.post("/upload", response_model=UploadResponse)
async def upload_pdf(file: UploadFile = File(...)):
    """Accept a PDF upload, validate, extract text and diagrams."""
    try:
        data = await file.read()
    except Exception:
        return JSONResponse(
            status_code=400,
            content=ErrorDetail(error_type="read_error", message="Failed to read uploaded file.").model_dump(),
        )

    try:
        result = pdf_processor.process_pdf(data)
    except pdf_processor.PDFError as exc:
        status = {
            "not_pdf": 400,
            "too_large": 413,
            "empty_file": 400,
            "encrypted": 422,
            "corrupted": 422,
            "processing_timeout": 504,
            "no_questions": 422,
        }.get(exc.error_type, 400)
        return JSONResponse(
            status_code=status,
            content=ErrorDetail(error_type=exc.error_type, message=exc.message).model_dump(),
        )

    diagrams = {
        did: Diagram(**d) for did, d in result.diagrams.items()
    }

    # Format per-page structured source for "Exact from PDF" mode.
    # Include the diagrams dict so each page's prompt section lists the
    # diagram IDs the LLM can reference in its diagramRefs output.
    from app.services.pdf_processor import format_pages_for_extract
    if result.page_blocks:
        # diagrams here is {did: Diagram}; convert to the shape
        # format_pages_for_extract expects ({did: {page, image_data}}).
        diag_for_prompt = {
            did: {"page": d.page, "image_data": d.image_data}
            for did, d in diagrams.items()
        }
        pages = format_pages_for_extract(result.page_blocks, diagrams=diag_for_prompt)

        # Build per-page layout data (question y-bboxes + figure y-bboxes)
        # so the extract endpoint can assign each figure to the question
        # whose text is vertically nearest. Without this, the LLM returns
        # over-broad diagramRefs (every figure on every figure-question)
        # and the UI shows wrong diagrams on wrong questions.
        page_layouts: list[dict] = []
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
    else:
        pages = ""
        page_layouts = []

    return UploadResponse(
        text=result.text,
        diagrams=diagrams,
        pages=[pages] if pages else [],  # single concatenated string in a 1-element list
        page_layouts=page_layouts,
    )
