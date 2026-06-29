"""PDF validation, text extraction, OCR fallback, and diagram extraction.

Designed for a 512 MB environment: pages are processed one at a time and
intermediate buffers are released promptly.
"""

from __future__ import annotations

import base64
import io
import logging
import re
import time
from dataclasses import dataclass, field

import fitz  # PyMuPDF
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)

# ── Exceptions ─────────────────────────────────────────────────────────────────

class PDFError(Exception):
    """Base for all PDF-related errors."""
    error_type: str = "pdf_error"

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class PDFNotPDFError(PDFError):
    error_type = "not_pdf"


class PDFTooLargeError(PDFError):
    error_type = "too_large"


class PDFEmptyError(PDFError):
    error_type = "empty_file"


class PDFEncryptedError(PDFError):
    error_type = "encrypted"


class PDFCorruptedError(PDFError):
    error_type = "corrupted"


class ProcessingTimeoutError(PDFError):
    error_type = "processing_timeout"


class NoQuestionsDetectedError(PDFError):
    error_type = "no_questions"


# ── Result containers ──────────────────────────────────────────────────────────

@dataclass
class ExtractionResult:
    text: str
    diagrams: dict[str, dict] = field(default_factory=dict)  # id -> {page, image_data}
    has_selectable_text: bool = False
    page_blocks: list[PageBlocks] = field(default_factory=list)


# ── Validation ─────────────────────────────────────────────────────────────────

def validate_pdf(data: bytes) -> None:
    """Raise the appropriate PDFError if *data* is not a valid, openable PDF."""
    if len(data) == 0:
        raise PDFEmptyError("Uploaded file is empty (0 bytes).")
    if len(data) > settings.MAX_PDF_SIZE_BYTES:
        raise PDFTooLargeError(
            f"File size {len(data):,} bytes exceeds the "
            f"{settings.MAX_PDF_SIZE_BYTES:,}-byte limit."
        )
    # Quick magic-byte check
    if not data[:5].startswith(b"%PDF"):
        raise PDFNotPDFError("The file does not appear to be a PDF (bad magic bytes).")
    # Try to open with PyMuPDF to detect corruption / encryption
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PDFCorruptedError(f"Cannot open PDF: {exc}") from exc
    try:
        if doc.is_encrypted:
            raise PDFEncryptedError("The PDF is password-protected and cannot be processed.")
    finally:
        doc.close()


# ── Text extraction ────────────────────────────────────────────────────────────

def _extract_selectable_text(doc: fitz.Document) -> str:
    """Return concatenated page text if the PDF has selectable text."""
    chunks: list[str] = []
    for page in doc:
        text = page.get_text("text")
        if text:
            chunks.append(text.strip())
    return "\n\n".join(chunks)


# ── Structured block extraction (for "Exact from PDF" mode) ───────────────────

@dataclass
class PageBlocks:
    """Structured per-page content for the verbatim-extraction LLM prompt.

    Layouts like the JEE Main paper place question text in the top half of a
    page and option-value fragments in a row at the bottom (with the option
    labels ``(1)(2)(3)(4)`` inline near the question). Naive ``get_text``
    dumps everything in reading order so options end up detached from their
    question — the LLM can't tell which ``π√LC/3`` belongs to Q1.

    ``PageBlocks`` separates the question body from the option value pool and
    hands the LLM a clear hint about where each option value lives.

    ``question_block_positions`` mirrors ``question_blocks`` 1:1 and stores
    the vertical bbox for each question header (Q1., Q2., …). Used
    downstream by ``quiz_generator`` to assign each figure on the page to
    the question whose text is vertically nearest to it — much more
    accurate than the LLM's own assignment for PDFs with multiple figures
    on one page.
    """

    page_number: int
    question_blocks: list[str]  # text fragments that contain "Qn." markers
    option_value_pool: list[str]  # short fragments below y≈0.6 of the page
    image_positions: list[tuple[float, float, float, float]]  # bbox tuples
    raw_text: str  # the unprocessed page text (fallback)
    # Per-question-header bbox, same length as ``question_blocks``. Default
    # factory lets ``PageBlocks(...)`` still construct with no kwargs.
    question_block_positions: list[tuple[float, float]] = field(
        default_factory=list
    )  # (y0, y1) per question header

    def to_prompt_section(self, diagram_ids: list[str] | None = None) -> str:
        """Format this page for the LLM extract prompt.

        ``diagram_ids`` is the list of figure IDs we extracted from THIS
        page (e.g. ["page-1-figure-1", "page-1-figure-2"]). Surfaced
        here so the LLM can reference them in its output's
        ``diagramRefs`` array.
        """
        lines = [f"--- Page {self.page_number} ---"]
        if self.question_blocks:
            lines.append("Question text (in reading order):")
            for block in self.question_blocks:
                lines.append(f"  | {block}")
        if self.option_value_pool:
            lines.append(
                "Option-value fragments (loose fragments at the bottom of the "
                "page, possibly containing math expressions). The first 4 are "
                "typically Q's options (1), (2), (3), (4):"
            )
            for i, val in enumerate(self.option_value_pool, start=1):
                lines.append(f"  [{i}] {val}")
        if diagram_ids:
            lines.append(
                f"Embedded diagrams on this page: {diagram_ids}. "
                "Any question on this page that mentions 'the figure', 'shown "
                "in the figure', 'in the given circuit', or 'as shown' MUST "
                f"include these diagram IDs in its diagramRefs array — use "
                f"exactly these strings: {diagram_ids}"
            )
        elif self.image_positions:
            lines.append(
                f"Embedded images on this page: {len(self.image_positions)} "
                "(questions referencing 'the figure' should be matched to these)."
            )
        if not self.question_blocks and not self.option_value_pool:
            lines.append(f"(empty page)\n{self.raw_text[:500]}")
        return "\n".join(lines)


# Pattern that matches a question header at the start of a block.
_QUESTION_HEADER_RE = re.compile(
    r"^\s*Q\s*\d+\s*[\.\)]\s*", re.IGNORECASE
)


def _extract_page_blocks(doc: fitz.Document) -> list[PageBlocks]:
    """Walk each page, split into question-text blocks + option-value pool.

    Heuristic for option pool: text fragments whose y-position is in the
    bottom 40% of the page AND are short (<= 50 chars per fragment) AND
    don't contain a question header. This is loose enough to work across
    both 2-column JEE papers (option values form a horizontal row) and
    single-column NCERT layouts (option values are inline but still
    fragmentary due to embedded equation images).

    Returns one ``PageBlocks`` per page.
    """
    pages: list[PageBlocks] = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        page_dict = page.get_text("dict")
        blocks = page_dict.get("blocks", [])
        page_h = page.rect.height
        page_w = page.rect.width
        bottom_y = page_h * 0.60

        question_blocks: list[str] = []
        option_pool: list[str] = []
        image_positions: list[tuple[float, float, float, float]] = []
        question_block_positions: list[tuple[float, float]] = []
        all_text_pieces: list[str] = []

        # Use get_image_rects (per-xref, accurate positions) as the
        # primary source for figure bboxes. Fall back to the dict-block
        # walker when it returns nothing (rare — only happens if every
        # figure is drawn as a vector path rather than embedded).
        seen_xrefs: set[int] = set()
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)
            try:
                rects = page.get_image_rects(xref)
            except Exception:
                rects = []
            for r in rects:
                image_positions.append((r.x0, r.y0, r.x1, r.y1))

        for block in blocks:
            btype = block.get("type", 0)
            bbox = block.get("bbox", [0, 0, 0, 0])
            x0, y0, x1, y1 = bbox

            # Image positions are now collected via page.get_image_rects
            # above. Skip dict-block-walker image collection to avoid
            # double-counting (some PDFs report the same image twice).
            if btype == 1:
                continue

            # Text block — concatenate spans.
            text_pieces: list[str] = []
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text_pieces.append(span.get("text", ""))
            text = "".join(text_pieces).strip()
            if not text:
                continue
            all_text_pieces.append(text)

            # Question-header blocks: contains "Qn." pattern — always treat as
            # question text regardless of position.
            if _QUESTION_HEADER_RE.match(text):
                question_blocks.append(text)
                question_block_positions.append((y0, y1))
                continue

            # Short fragment in the bottom 40% of the page AND not a question
            # header → candidate option value. Skip very long blocks (paragraphs).
            if y0 >= bottom_y and len(text) <= 60:
                # Clean up: strip "(1)(2)(3)(4)" labels if present.
                cleaned = re.sub(r"\(\s*\d+\s*\)", "", text).strip()
                if cleaned and len(cleaned) <= 60:
                    option_pool.append(cleaned)
                # Even if the cleaned version is empty, the original counts
                # as a separator marker.
                if not cleaned:
                    option_pool.append(text)
                continue

            # Long block above the fold OR any non-short non-header block →
            # question body.
            question_blocks.append(text)

        raw_text = "\n".join(all_text_pieces)
        pages.append(PageBlocks(
            page_number=page_num + 1,
            question_blocks=question_blocks,
            option_value_pool=option_pool,
            image_positions=image_positions,
            question_block_positions=question_block_positions,
            raw_text=raw_text,
        ))
    return pages


def format_pages_for_extract(
    pages: list[PageBlocks],
    diagrams: dict[str, dict] | None = None,
) -> str:
    """Concatenate ``PageBlocks`` into the source text fed to the LLM.

    ``diagrams`` (optional) maps diagram id → {page, image_data}. We
    forward the IDs to each page so the LLM knows exactly which strings
    to put in its ``diagramRefs`` output.
    """
    # Group diagram ids by page so we can include them with the page
    # text that references them.
    by_page: dict[int, list[str]] = {}
    if diagrams:
        for did, d in diagrams.items():
            pg = d.get("page")
            if isinstance(pg, int):
                by_page.setdefault(pg, []).append(did)

    return "\n\n".join(
        p.to_prompt_section(diagram_ids=by_page.get(p.page_number))
        for p in pages
    )


def extract_answer_key(pages: list[PageBlocks]) -> str:
    """Pull the answer-key section out of the PDF if present.

    Detects the "ANSWERS AND SOLUTIONS" header that JEE/NEET papers
    start their key with and returns the text of the pages that
    contain it (so the LLM has the answer key in front of it when it
    classifies questions and writes ``correctAnswerId`` /
    ``numericalAnswer``).

    Returns an empty string when no answer-key section is detected.
    """
    key_pages: list[str] = []
    for p in pages:
        text = (p.raw_text or "").strip()
        if "ANSWERS AND SOLUTIONS" in text or "ANSWER KEY" in text.upper():
            # Keep the raw text — it's the answer key + the worked
            # solutions, both useful for the LLM.
            key_pages.append(f"--- Page {p.page_number} (answer key) ---\n{text}")
    return "\n\n".join(key_pages)


# ── OCR fallback ──────────────────────────────────────────────────────────────

def _ocr_document(doc: fitz.Document) -> str:
    """Render each page to an image and OCR it. Processes one page at a time."""
    try:
        import pytesseract
    except ImportError:
        logger.warning("pytesseract not installed; OCR fallback unavailable.")
        return ""

    chunks: list[str] = []
    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            # Render at 200 DPI – enough for OCR, low memory
            pix = page.get_pixmap(dpi=200)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            try:
                text = pytesseract.image_to_string(img)
            except pytesseract.TesseractNotFoundError:
                logger.warning("tesseract binary not found; OCR fallback unavailable.")
                return ""
            # Free memory immediately
            del img, pix
            if text and text.strip():
                chunks.append(text.strip())
    except Exception as exc:
        logger.warning("OCR failed: %s", exc)
        return ""
    return "\n\n".join(chunks)


# ── Diagram extraction ────────────────────────────────────────────────────────

# ── Diagram size filter ───────────────────────────────────────────────────────
# NCERT/Chemistry PDFs commonly embed bullets, separators, and tiny icons
# (~27x35 px, <1KB) as separate "images" in every PDF page, AND wide thin
# chapter banners (e.g. 883x131 px decoration strips across page headers).
# The JEE/NEET paper PDFs ship 1-2 real diagrams (400-1000 px wide, mostly
# square-ish or taller-than-wide). Filtering tiny non-substantive images
# AND wide thin banners here is the difference between a 200KB request body
# (1-2 real figures) and a 2.5MB body (315 bullets + banners) that breaks
# the browser→Vite→backend fetch pipeline ("Failed to fetch" symptom).
_MIN_DIAGRAM_SHORT_EDGE_PX = 100  # shorter edge must be ≥100 px
_MIN_DIAGRAM_LONG_EDGE_PX = 200   # longer edge must be ≥200 px
_MIN_DIAGRAM_BYTES = 3_000        # raw image bytes must be ≥3KB
_MAX_DIAGRAM_ASPECT = 3.5         # max(long/short) — banners fail this


def _looks_like_real_diagram(width: int, height: int, raw_bytes_len: int) -> bool:
    """True iff the image has enough substance to be a real figure.

    Bullets / icon decorations are 20-50px wide and <1KB raw. Wide thin
    chapter banners are ~880px wide × 80-250px tall (aspect > 4).
    Real circuit diagrams, waveforms, mechanics, and optical diagrams
    are ≥200px on each dimension and roughly square-ish or
    taller-than-wide. This filter drops 95%+ of false-positives
    (decorations + banners) without losing genuine figures.
    """
    if width <= 0 or height <= 0:
        return False
    short_edge = min(width, height)
    long_edge = max(width, height)
    if short_edge < _MIN_DIAGRAM_SHORT_EDGE_PX:
        return False
    if long_edge < _MIN_DIAGRAM_LONG_EDGE_PX:
        return False
    aspect = long_edge / max(1, short_edge)
    if aspect > _MAX_DIAGRAM_ASPECT:
        return False
    if raw_bytes_len < _MIN_DIAGRAM_BYTES:
        return False
    return True


def _extract_diagrams(doc: fitz.Document) -> dict[str, dict]:
    """Extract embedded images, resize, and base64-encode them.

    Filters out tiny bullets / icons / separators that NLP-grade PDFs
    embed by the hundreds (e.g. NCERT chapter PDFs have 200+ "images"
    per file, mostly 27x35 px bullet decorations). Only images that
    pass the ``_looks_like_real_diagram`` heuristic are kept.
    """
    diagrams: dict[str, dict] = {}
    img_index = 0

    for page_num in range(len(doc)):
        page = doc[page_num]
        image_list = page.get_images(full=True)
        for img_info in image_list:
            xref = img_info[0]
            try:
                base_image = doc.extract_image(xref)
            except Exception:
                logger.debug("Could not extract image xref=%d", xref)
                continue
            if not base_image or not base_image.get("image"):
                continue

            raw_bytes: bytes = base_image["image"]
            ext = base_image.get("ext", "png")

            # Decode to check dimensions before re-encoding (saves work
            # when we drop 95%+ of images as too-small).
            try:
                pil_check = Image.open(io.BytesIO(raw_bytes))
                w, h = pil_check.size
                pil_check.close()
            except Exception:
                w, h = 0, 0

            if not _looks_like_real_diagram(w, h, len(raw_bytes)):
                logger.debug(
                    "Skipping non-diagram image page=%d xref=%d (%dx%d, %d bytes)",
                    page_num + 1, xref, w, h, len(raw_bytes),
                )
                continue

            # Resize if too large
            try:
                pil_img = Image.open(io.BytesIO(raw_bytes))
                pil_img = _resize_image(pil_img)
                buf = io.BytesIO()
                # Always re-encode as JPEG for consistency & smaller size
                if pil_img.mode == "RGBA":
                    pil_img = pil_img.convert("RGB")
                pil_img.save(buf, format="JPEG", quality=settings.DIAGRAM_JPEG_QUALITY)
                encoded = base64.b64encode(buf.getvalue()).decode("ascii")
                del pil_img
            except Exception:
                encoded = base64.b64encode(raw_bytes).decode("ascii")

            diagram_id = f"page-{page_num + 1}-figure-{img_index + 1}"
            diagrams[diagram_id] = {
                "id": diagram_id,
                "page": page_num + 1,
                "image_data": encoded,
            }
            img_index += 1

    return diagrams


def _resize_image(img: Image.Image) -> Image.Image:
    """Resize so the long edge is at most MAX_DIAGRAM_LONG_EDGE pixels."""
    max_edge = settings.MAX_DIAGRAM_LONG_EDGE
    w, h = img.size
    if max(w, h) <= max_edge:
        return img
    scale = max_edge / max(w, h)
    new_size = (int(w * scale), int(h * scale))
    return img.resize(new_size, Image.LANCZOS)


# ── Public API ─────────────────────────────────────────────────────────────────

def process_pdf(data: bytes) -> ExtractionResult:
    """Validate, extract text (with OCR fallback), and extract diagrams.

    Raises PDFError subclasses on failure.
    """
    validate_pdf(data)

    start = time.monotonic()
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        # 1. Try selectable text
        text = _extract_selectable_text(doc)
        has_selectable = bool(text.strip())

        # 2. OCR fallback if no selectable text
        if not has_selectable:
            elapsed = time.monotonic() - start
            remaining = settings.PROCESSING_TIMEOUT_SECONDS - elapsed
            if remaining <= 0:
                raise ProcessingTimeoutError("Processing budget exhausted before OCR.")
            text = _ocr_document(doc)

        # 3. Diagrams
        elapsed = time.monotonic() - start
        if elapsed > settings.PROCESSING_TIMEOUT_SECONDS:
            raise ProcessingTimeoutError("Processing budget exhausted.")
        diagrams = _extract_diagrams(doc)

        # 4. Structured blocks (for "Exact from PDF" mode). Cheap — same PyMuPDF
        # call we already did for text, so we re-walk the doc only if needed.
        page_blocks: list[PageBlocks] = []
        try:
            page_blocks = _extract_page_blocks(doc)
        except Exception as exc:
            logger.warning("page-blocks extraction failed: %s", exc)
            page_blocks = []

        # 4. Check if we got anything useful
        if not text.strip() and not diagrams:
            raise NoQuestionsDetectedError(
                "No selectable text or diagrams found in the PDF even after OCR."
            )

        return ExtractionResult(
            text=text,
            diagrams=diagrams,
            has_selectable_text=has_selectable,
            page_blocks=page_blocks,
        )
    finally:
        doc.close()
