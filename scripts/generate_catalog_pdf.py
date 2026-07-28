from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "catalogo-pino-forte.pdf"
PUBLIC = ROOT / "public"

PRODUCTS = [
    ("RN 180", "Linha Randon", "180 mm", "R$ 49,00", "img-000.png"),
    ("RN 190", "Linha Randon", "190 mm", "R$ 55,00", "img-001.png"),
    ("RN 205", "Linha Randon", "205 mm", "R$ 56,00", "img-002.png"),
    ("RN 225", "Linha Randon", "225 mm", "R$ 57,00", "img-003.png"),
    ("RO 215", "Linha Rodoviária", "215 mm", "R$ 63,00", "img-004.png"),
    ("RO 235", "Linha Rodoviária", "235 mm", "R$ 68,00", "img-005.png"),
]

ORANGE = HexColor("#F45A00")
BLACK = HexColor("#080808")
TEXT = HexColor("#202020")
MUTED = HexColor("#6B6B6B")
BORDER = HexColor("#DADADA")
PAGE_BG = HexColor("#F4F4F2")


def fit_image(c, path, x, y, max_w, max_h):
    image = ImageReader(str(path))
    width, height = image.getSize()
    scale = min(max_w / width, max_h / height)
    draw_w, draw_h = width * scale, height * scale
    c.drawImage(
        image,
        x + (max_w - draw_w) / 2,
        y + (max_h - draw_h) / 2,
        draw_w,
        draw_h,
        preserveAspectRatio=True,
        mask="auto",
    )


def centered_text(c, value, y, font, size, color):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString((A4[0] - stringWidth(value, font, size)) / 2, y, value)


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    width, height = A4

    c.setFillColor(PAGE_BG)
    c.rect(0, 0, width, height, stroke=0, fill=1)

    header_h = 132
    c.setFillColor(BLACK)
    c.rect(0, height - header_h, width, header_h, stroke=0, fill=1)
    c.setFillColor(ORANGE)
    c.rect(0, height - 5, width, 5, stroke=0, fill=1)

    fit_image(c, PUBLIC / "logo-sistema.png", 30, height - 111, 225, 78)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 25)
    c.drawRightString(width - 30, height - 67, "CATÁLOGO DE PREÇOS")
    c.setFillColor(HexColor("#BEBEBE"))
    c.setFont("Helvetica", 9)
    c.drawRightString(width - 30, height - 86, "PEÇAS PARA SUSPENSÃO DE TRUCK E CARRETA")

    margin_x = 30
    gap_x = 12
    gap_y = 12
    card_w = (width - 2 * margin_x - gap_x) / 2
    card_h = 174
    grid_top = height - header_h - 24

    for index, (code, line, measure, price, image_name) in enumerate(PRODUCTS):
        row, col = divmod(index, 2)
        x = margin_x + col * (card_w + gap_x)
        y = grid_top - (row + 1) * card_h - row * gap_y

        c.setFillColor(white)
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.7)
        c.roundRect(x, y, card_w, card_h, 10, stroke=1, fill=1)

        c.setFillColor(ORANGE)
        c.roundRect(x + 14, y + card_h - 38, 58, 24, 5, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(x + 43, y + card_h - 30, code)

        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 17)
        c.drawRightString(x + card_w - 14, y + card_h - 32, price)

        fit_image(c, PUBLIC / image_name, x + 14, y + 18, 116, 105)

        text_x = x + 144
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 8)
        c.drawString(text_x, y + 103, line.upper())
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(text_x, y + 82, "Pino de balança")
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(text_x, y + 67, "COMUM")
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(text_x, y + 51, "Medida")
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(text_x, y + 33, measure)

    footer_y = 23
    c.setFillColor(BLACK)
    c.roundRect(margin_x, footer_y, width - 2 * margin_x, 76, 10, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin_x + 18, footer_y + 49, "Faça seu pedido pelo WhatsApp")
    c.setFillColor(HexColor("#CCCCCC"))
    c.setFont("Helvetica", 9)
    c.drawString(margin_x + 18, footer_y + 31, "(43) 99156-5317")
    c.drawString(margin_x + 18, footer_y + 16, "www.pinoforte.com.br/catalogo")
    fit_image(c, PUBLIC / "catalogo-qrcode.png", width - margin_x - 64, footer_y + 8, 60, 60)

    c.setTitle("Catálogo de preços - Pino Forte")
    c.setAuthor("Pino Forte")
    c.setSubject("Catálogo de pinos de balança")
    c.showPage()
    c.save()


if __name__ == "__main__":
    build()
