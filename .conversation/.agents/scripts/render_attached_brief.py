from pathlib import Path
import fitz

source = Path("attached_assets/PDFReader_20261004_1905_1791121092629.pdf")
output = Path(".agents/outputs/mandi-pdf")
output.mkdir(parents=True, exist_ok=True)

document = fitz.open(source)
print(f"pages={document.page_count}")
for index, page in enumerate(document):
    text = page.get_text().strip()
    print(f"page={index + 1} size={page.rect.width:.0f}x{page.rect.height:.0f} text_chars={len(text)}")
    page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(output / f"page-{index + 1}.png")