"""Extract text + images from the user's PDF to see what options are in the source."""
import fitz, json, re

pdf_path = r"C:\Users\dell\OneDrive\Desktop\test\.hermes\desktop-attachments\Alternating Current - JEE Main 2026 (Jan) - MathonGo.pdf"
doc = fitz.open(pdf_path)
print(f"pages: {doc.page_count}\n")

total_text_chars = 0
total_images = 0
for i in range(min(3, doc.page_count)):
    page = doc[i]
    text = page.get_text("text")
    images = page.get_images()
    total_text_chars += len(text)
    total_images += len(images)
    print(f"--- page {i+1} ---")
    print(f"text chars: {len(text)}")
    print(f"images: {len(images)}")
    print("FIRST 3000 chars:")
    print(text[:3000])
    print("..." if len(text) > 3000 else "")
    print()

print(f"\n=== TOTAL across {doc.page_count} pages: {total_text_chars} chars + {total_images} images ===")

text_all = ""
for i in range(doc.page_count):
    text_all += doc[i].get_text("text") + "\n\n--- PAGE BREAK ---\n\n"
with open(r"C:\Users\dell\OneDrive\Desktop\test\alt_current_text.txt", "w", encoding="utf-8") as f:
    f.write(text_all)
print(f"\nSaved extracted text to alt_current_text.txt ({len(text_all)} chars)")

doc.close()