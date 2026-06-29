"""Inspect the user's JEE PDF page-by-page with PyMuPDF BLOCKS — find the actual
reading-order rules for option-text-fragments, embedded equation images, and
how questions/options get separated."""
import fitz, json, re

pdf_path = r"C:\Users\dell\OneDrive\Desktop\test\.hermes\desktop-attachments\Alternating Current - JEE Main 2026 (Jan) - MathonGo.pdf"
doc = fitz.open(pdf_path)

print(f"=== PDF: {pdf_path} ===\n")
print(f"pages: {doc.page_count}\n")

for i in range(doc.page_count):
    page = doc[i]
    page_dict = page.get_text("dict")
    blocks = page_dict.get("blocks", [])
    images = page.get_images()
    page_w = page.rect.width
    page_h = page.rect.height
    print(f"\n=== PAGE {i+1} (size: {page_w:.0f}x{page_h:.0f}, blocks: {len(blocks)}, images: {len(images)}) ===")

    for bi, block in enumerate(blocks):
        btype = block.get("type", 0)
        bbox = block.get("bbox", [0, 0, 0, 0])
        x0, y0, x1, y1 = bbox
        if btype == 1:  # image block
            print(f"  block {bi}: IMAGE at x=[{x0:.0f},{x1:.0f}] y=[{y0:.0f},{y1:.0f}] size={x1-x0:.0f}x{y1-y0:.0f}")
        else:
            # text block — concatenate the lines
            text_pieces = []
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text_pieces.append(span.get("text", ""))
            text = "".join(text_pieces).strip()
            if text:
                col = "LEFT" if x1 < page_w * 0.5 else ("RIGHT" if x0 > page_w * 0.5 else "FULL")
                print(f"  block {bi}: TEXT-{col} at x=[{x0:.0f},{x1:.0f}] y=[{y0:.0f},{y1:.0f}]")
                print(f"    >> {text[:120]}{'...' if len(text)>120 else ''}")

doc.close()