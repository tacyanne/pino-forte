import type { jsPDF } from "jspdf";

type CatalogDetails = { name: string; pieceType: string; measure: string };

export function catalogPdfDetails(pdf: jsPDF, product: CatalogDetails) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  const type: string[] = pdf.splitTextToSize(product.pieceType, 37);
  pdf.setFontSize(9);
  const description: string[] = pdf.splitTextToSize(product.name, 37);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  const measure: string[] = pdf.splitTextToSize(product.measure, 37);
  return {
    type,
    description,
    measure,
    height: Math.max(
      50,
      22 + type.length * 3 + description.length * 4 + measure.length * 4 + 6,
    ),
  };
}

export function drawCatalogPdfDetails(
  pdf: jsPDF,
  product: CatalogDetails,
  x: number,
  y: number,
) {
  const details = catalogPdfDetails(pdf, product);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(95, 95, 95);
  pdf.setFontSize(7);
  pdf.text(details.type, x, y, { lineHeightFactor: 1.2 });
  let nextY = y + details.type.length * 3 + 2;
  pdf.setTextColor(35, 35, 35);
  pdf.setFontSize(9);
  pdf.text(details.description, x, nextY, { lineHeightFactor: 1.2 });
  nextY += details.description.length * 4 + 2;
  pdf.setFont("helvetica", "bold");
  pdf.text(details.measure, x, nextY, { lineHeightFactor: 1.2 });
}
